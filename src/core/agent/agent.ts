// XQoderAgent Core Class
// ============================================================

import type {
    LLMProviderConfig,
    MessageAttachment,
    LSPServerConfig,
    MCPServerConfig,
    StreamCallbacks,
    ToolCall,
    SandboxMode,
    ShellConfig,
    PermissionSettings,
    AgentPermissionMode,
    HooksSettings,
    ToolResult,
} from '@xqoder/shared';
import { AgentError, logger as defaultLogger, Logger, calculateCost, getContextWindow, type CompactionConfig } from '@xqoder/shared';
import { getXQoderPaths } from '@xqoder/shared';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    type CompletionRequest,
} from '@xqoder/llm-api';
import {
    createLLMProvider,
} from './llm/factory.js';
import { ExternalLanguageServerManager } from './lsp-manager.js';
import { McpServerManager } from './mcp.js';
import { ToolRegistry, type QuestionAnswer, type QuestionPrompt, type ToolApprovalRequest, type ToolContext } from './tools/tool.js';
import { ListFilesTool, GlobFilesTool, GrepContentTool } from './tools/discovery-tools.js';
import { ReadFileTool, WriteFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
import { SourcegraphTool } from './tools/sourcegraph-tool.js';
import { RunCommandTool, InstallPackageTool } from './tools/command-tool.js';
import { QuestionTool, SkillTool, TodoReadTool, TodoWriteTool } from './tools/interaction-tools.js';
import { createDefaultLspTools } from './tools/lsp-tools.js';
import { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
import { FetchUrlTool, WebSearchTool } from './tools/fetch-tool.js';
import { DiagnosticsTool } from './tools/diagnostics-tool.js';
import { DelegateTaskTool } from './tools/agent-tool.js';
import { FileRollbackStore, type RollbackStore } from './tools/rollback-store.js';
import {
    buildPostToolUseFailureHookPayload,
    buildPostToolUseHookPayload,
    buildPreToolUseHookPayload,
    formatHookFeedbackSection,
    runToolHooks,
} from './hooks.js';
import { AgentSession } from './session/session.js';
import {
    type AgentProtocol,
    type AgentEvent,
    type AgentEvents,
    type Unsubscribe,
    type AgentSend,
} from './protocol.js';
import { resolveToolPermissionMode } from '../../domain/permissions/index.js';
import { createToolApprovalHandler } from '../../application/permissions/index.js';

/** Agent Configuration */
export interface AgentConfig {
    llmConfig: LLMProviderConfig;
    systemPrompt?: string;
    maxIterations?: number;
    cwd?: string;
    projectRoot?: string;
    sandboxMode?: SandboxMode;
    allowedPaths?: string[];
    shell?: ShellConfig;
    mcpServers?: MCPServerConfig[];
    lspServers?: LSPServerConfig[];
    session?: AgentSession;
    sessionTitle?: string;
    autoApproveTools?: boolean;
    rollbackStore?: RollbackStore;
    /** XQoder style: prioritize short-circuiting based on permission keys allow/ask/deny before tool execution */
    permissions?: PermissionSettings;
    /** Disable configured runtime hooks without deleting them */
    disableAllHooks?: boolean;
    /** Runtime hooks grouped by lifecycle event */
    hooks?: HooksSettings;
    /** Session compaction configuration */
    compaction?: CompactionConfig;
}

/** Agent runtime callbacks */
/** Agent runtime callbacks */
export interface AgentCallbacks extends StreamCallbacks {
    /** Tool execution start */
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    /** Tool execution end */
    onToolEnd?: (name: string, result: string, success: boolean) => void;
    /** Streaming output during tool execution */
    onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
    /** Pre-execution tool approval */
    onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean> | boolean;
    /** Structured questioning */
    onQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer> | QuestionAnswer;
    /** Iteration counting */
    onIteration?: (count: number) => void;
}

/** Default system prompt */
export const DEFAULT_SYSTEM_PROMPT = `You are XQoder, an AI programming assistant. You can:
- Read and write files
- Search code
- Read TypeScript/JavaScript symbols, definitions, references, and diagnostics
- Read multi-language symbols, definitions, references, and diagnostics via external Language Servers
- Read hover, completion, and perform safe symbol renaming as needed
- Execute terminal commands
- Install dependency packages
- Call external MCP tools
- Read MCP resources and prompts
- Delegate research tasks to sub-agents (delegate_task) to help explore the codebase
- Load skill documentation (skill)
- Record/read task lists (todowrite / todoread)
- Initiate structured questioning (question)

Please use tools to complete programming tasks according to the user's needs. Verify the results after each operation.
If an error occurs, analyze the reason and try to fix it.
For tasks requiring extensive codebase exploration (e.g., finding all usages, understanding module architecture), use delegate_task to delegate to sub-agents.

Output Style Requirements:
- Use concise and straightforward text
- Do not use emojis or decorative symbols
- Use "-" as a standard list symbol only when necessary

Permission and Path Policies (VERY IMPORTANT):
- Operations are by default within the project directory
- If the user explicitly requests operations outside the project directory (e.g., Desktop, Downloads, system paths), do not refuse directly, and do not suggest alternatives like "writing it to the project first and then copying it"
- Directly attempt the target path as requested by the user, allowing tools to trigger a permission approval popup for the user to decide
- When the user expresses "letting you operate the entire computer/giving you full permissions", prioritize triggering the permission approval process and wait for the user's selection`;

// createLLMProvider has been moved to factory.ts for decoupling

/**
 * XQoderAgent Core Class
 *
 * Responsibilities:
 * 1. Manage LLM Providers
 * 2. Register and schedule tools
 * 3. Maintain session context
 * 4. Execute the Agent Loop (Message -> LLM -> Tool Call -> Result Feedback -> Loop)
 */
export class XQoderAgent implements AgentProtocol {
    private provider?: import('./llm/provider.js').ILLMProvider;
    private toolRegistry: ToolRegistry;
    private session: AgentSession;
    private readonly maxIterations: number;
    private readonly toolContext: ToolContext;
    private logger: Logger;
    private readonly rollbackStore: RollbackStore;
    private readonly mcpManager?: McpServerManager;
    private readonly lspManager?: ExternalLanguageServerManager;
    private readonly mcpToolNames = new Set<string>();
    private readonly llmConfig: LLMProviderConfig;
    private readonly autoApproveTools: boolean;
    private readonly permissions?: PermissionSettings;
    private readonly disableAllHooks: boolean;
    private readonly hooks?: HooksSettings;
    private readonly compaction?: CompactionConfig;
    private activeAbort?: AbortController;
    private subscribers = new Set<(event: AgentEvent) => void>();
    private eventHistory: AgentEvent[] = [];

    constructor(config: AgentConfig) {
        this.llmConfig = config.llmConfig;
        // Provider will be initialized lazily in ensureProvider()

        // Initialize tool registry
        this.toolRegistry = new ToolRegistry();

        // Initialize session
        this.session = config.session ?? new AgentSession({
            systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            title: config.sessionTitle,
        });
        if (!config.session && config.sessionTitle) {
            this.session.setTitle(config.sessionTitle);
        }

        this.maxIterations = config.maxIterations ?? 20;
        this.autoApproveTools = config.autoApproveTools ?? false;
        this.permissions = config.permissions;
        this.disableAllHooks = config.disableAllHooks ?? false;
        this.hooks = config.hooks;
        this.compaction = config.compaction;
        const projectRoot = path.resolve(config.projectRoot ?? config.cwd ?? process.cwd());
        this.rollbackStore = config.rollbackStore ?? new FileRollbackStore(getXQoderPaths().rollbackDir);
        this.toolContext = {
            cwd: path.resolve(config.cwd ?? projectRoot),
            projectRoot,
            sandboxMode: config.sandboxMode ?? 'project',
            allowedPaths: (config.allowedPaths ?? []).map((entry) => path.resolve(entry)),
            shell: config.shell,
            rollbackStore: this.rollbackStore,
        };
        this.logger = defaultLogger.child('Agent');
        if ((config.mcpServers ?? []).some((server) => server.enabled !== false)) {
            this.mcpManager = new McpServerManager({
                servers: config.mcpServers ?? [],
                cwd: this.toolContext.cwd,
                projectRoot,
                sandboxMode: this.toolContext.sandboxMode,
                allowedPaths: this.toolContext.allowedPaths,
                logger: this.logger,
            });
        }
        if ((config.lspServers ?? []).some((server) => server.enabled !== false)) {
            this.lspManager = new ExternalLanguageServerManager({
                servers: config.lspServers ?? [],
                cwd: this.toolContext.cwd,
                projectRoot,
                logger: this.logger,
            });
        }
        this.registerDefaultTools(config.lspServers ?? []);

        // Emit initial initialize event
        this.emit('initialize', {
            sessionId: this.session.id,
            workspace: this.toolContext.projectRoot,
            agentId: 'xqoder-agent',
            config: {
                model: this.llmConfig.model,
                provider: this.llmConfig.provider,
            },
        });
    }

    /** Implement AgentProtocol.subscribe */
    subscribe(callback: (event: AgentEvent) => void): Unsubscribe {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }

    /** Implement AgentProtocol.events */
    get events(): readonly AgentEvent[] {
        return this.eventHistory;
    }

    /** Emit standard AgentEvent */
    private emit<K extends keyof AgentEvents>(type: K, data: AgentEvents[K], streamId: string = 'global'): void {
        const event: AgentEvent = {
            id: randomUUID(),
            streamId,
            timestamp: new Date().toISOString(),
            type: type as any,
            ...data,
        } as AgentEvent;

        this.eventHistory.push(event);
        for (const subscriber of this.subscribers) {
            try { subscriber(event); } catch (err) { this.logger.error('Subscriber error', err); }
        }
    }

    /** Implement AgentProtocol.send */
    async send(payload: AgentSend): Promise<{ streamId: string | null }> {
        if (payload.message) {
            const streamId = randomUUID();
            // Start the run in the background or await it? 
            // AgentProtocol.send usually acknowledges receipt and returns a streamId.
            // We'll run it and return the streamId.
            void this.run(payload.message.content, undefined, payload.message.attachments, streamId);
            return { streamId };
        }
        if (payload.update) {
            if (payload.update.title) this.session.setTitle(payload.update.title);
            this.emit('session_update', {
                title: payload.update.title,
                model: payload.update.model,
                config: payload.update.config,
            });
            return { streamId: null };
        }
        return { streamId: null };
    }

    /** Implement AgentProtocol.abort */
    async abort(): Promise<void> {
        this.cancel();
    }

    /** Cancel running agent */
    cancel(): void {
        this.activeAbort?.abort();
        this.activeAbort = undefined;
    }

    /** Whether there is an active running request */
    get isRunning(): boolean {
        return this.activeAbort !== undefined && !this.activeAbort.signal.aborted;
    }

    async run(userMessage: string, callbacks?: AgentCallbacks, attachments: MessageAttachment[] = [], streamId: string = randomUUID()): Promise<string> {
        this.activeAbort?.abort();
        const abort = new AbortController();
        this.activeAbort = abort;

        this.emit('agent_start', { streamId }, streamId);
        this.emit('message', { role: 'user', content: userMessage }, streamId);

        const provider = await this.ensureProvider();
        this.session.addUserMessage(userMessage, attachments);
        this.logger.info(`User request: ${userMessage.slice(0, 100)}...`);

        let iteration = 0;

        try {
        while (iteration < this.maxIterations) {
            if (abort.signal.aborted) {
                this.logger.warn('Agent cancelled by user');
                this.emit('agent_end', { streamId, reason: 'aborted' }, streamId);
                return '[cancelled by user]';
            }

            iteration++;
            try { callbacks?.onIteration?.(iteration); } catch { /* UI callback failure */ }
            this.logger.debug(`Iteration ${iteration}/${this.maxIterations}`);
            try { await this.syncMcpTools(); } catch { /* MCP sync failure is non-fatal */ }

            // Build request
            const request: CompletionRequest = {
                messages: this.session.getMessages(),
                tools: this.toolRegistry.getDefinitions(),
            };

            // Call LLM
            let response;
            try {
                const streamCallbacks: StreamCallbacks = {
                    ...callbacks,
                    onToken: (token) => {
                        this.emit('message', { role: 'assistant', content: token }, streamId); // Note: Gemini style might delta this
                        callbacks?.onToken?.(token);
                    },
                    onThinkingToken: (token) => {
                        this.emit('thought', { content: token }, streamId);
                        callbacks?.onThinkingToken?.(token);
                    }
                };
                if (callbacks?.onToken || true) { // Always stream for protocol
                    response = await provider.stream(request, streamCallbacks);
                } else {
                    response = await provider.complete(request);
                }
            } catch (err) {
                const msg = `LLM call failed: ${err instanceof Error ? err.message : String(err)}`;
                this.emit('error', { message: msg, fatal: true }, streamId);
                throw new AgentError(msg);
            }

            // Cost tracking
            const cost = calculateCost(this.llmConfig.model, response.usage);
            this.session.recordUsage({ ...response.usage, cost });
            this.emit('usage', {
                model: this.llmConfig.model,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                totalTokens: response.usage.totalTokens,
                cost,
            }, streamId);

            // Auto-compact: if context usage ≥ 85%, trigger summarization (like Open Code / Claude Code)
            const ctxWindow = getContextWindow(this.llmConfig.model);
            if (this.compaction?.auto !== false && ctxWindow && response.usage.promptTokens >= ctxWindow * 0.85) {
                this.logger.warn(`Context usage at ${Math.round(response.usage.promptTokens / ctxWindow * 100)}%, triggering auto-compact`);
                try {
                    const messages = this.session.getMessages().filter(m => m.role !== 'system');
                    const summaryAgent = new (await import('./sub-agents.js')).SummarizerAgent(this.llmConfig);
                    const summary = await summaryAgent.summarize(messages);
                    this.session.performCompaction(summary);
                    this.emit('message', { role: 'system', content: `[Auto-compacted context summary]: ${summary}` }, streamId);
                    try { callbacks?.onToolEnd?.('auto_compact', summary, true); } catch { /* ignore */ }
                } catch (err) {
                    this.logger.error(`Auto-compact failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            // Save assistant message
            this.session.addAssistantMessage(response.message);

            // Check if there are tool calls
            if (response.finishReason === 'tool_calls' && response.message.toolCalls) {
                await this.executeToolCalls(response.message.toolCalls, callbacks, streamId);
                // Continue loop, let LLM handle tool results
                continue;
            }

            // No tool calls, Agent complete
            this.logger.success(`Agent completed in ${iteration} iterations`);
            this.emit('agent_end', { streamId, reason: 'completed' }, streamId);
            return response.message.content;
        }

        const maxIterMsg = `Maximum iterations reached (${this.maxIterations})`;
        this.emit('error', { message: maxIterMsg, fatal: true }, streamId);
        this.emit('agent_end', { streamId, reason: 'failed' }, streamId);
        throw new AgentError(maxIterMsg);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.emit('error', { message: msg, fatal: false }, streamId);
            this.emit('agent_end', { streamId, reason: 'error' }, streamId);
            throw err;
        } finally {
            this.activeAbort = undefined;
        }
    }

    /** Execute tool calls */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        callbacks?: AgentCallbacks,
        streamId: string = 'global'
    ): Promise<void> {
        for (const tc of toolCalls) {
            let args: Record<string, unknown>;
            try {
                args = (tc.arguments ? JSON.parse(tc.arguments) : {}) as Record<string, unknown>;
            } catch {
                args = {};
                this.logger.warn(`Tool ${tc.name} arguments parsing failed: ${tc.arguments?.slice(0, 100)}`);
            }
            this.logger.info(`Calling tool: ${tc.name}`);
            this.emit('tool_request', { requestId: tc.id, name: tc.name, args }, streamId);

            const perm = resolveToolPermissionMode(tc.name, this.permissions);
            const preHookResult = await runToolHooks(
                'PreToolUse',
                buildPreToolUseHookPayload({
                    sessionId: this.session.id,
                    cwd: this.toolContext.cwd,
                    projectRoot: this.toolContext.projectRoot,
                    permissionMode: perm,
                    toolName: tc.name,
                    toolInput: args,
                    toolUseId: tc.id,
                }),
                {
                    disableAllHooks: this.disableAllHooks,
                    hooks: this.hooks,
                    llmConfig: this.llmConfig,
                    cwd: this.toolContext.cwd,
                    projectRoot: this.toolContext.projectRoot,
                    sessionId: this.session.id,
                    permissionMode: perm,
                    logger: this.logger,
                },
            );
            for (const message of preHookResult.systemMessages) {
                this.logger.warn(`PreToolUse hook message: ${message}`);
            }

            if (preHookResult.permissionDecision === 'deny' || preHookResult.continue === false) {
                this.finalizeToolCall(
                    tc,
                    args,
                    buildHookBlockedResult(tc.id, tc.name, preHookResult, args),
                    callbacks,
                    streamId,
                );
                continue;
            }

            if (perm === 'deny') {
                this.finalizeToolCall(
                    tc,
                    args,
                    buildPermissionDeniedResult(tc.id, tc.name, preHookResult.additionalContexts),
                    callbacks,
                    streamId,
                );
                continue;
            }

            const requestToolApproval = createToolApprovalHandler({
                permissionMode: perm,
                autoApproveTools: this.autoApproveTools,
                forceInteractiveApproval: preHookResult.permissionDecision === 'ask',
                interactiveApproval: callbacks?.onToolApproval,
            });
            const requestQuestion = callbacks?.onQuestion
                ? (prompt: QuestionPrompt) => Promise.resolve(callbacks.onQuestion?.(prompt) ?? {
                    requestId: prompt.requestId,
                    selected: [],
                })
                : undefined;

            try { callbacks?.onToolStart?.(tc.name, args); } catch { /* UI callback must not crash agent */ }
            const startedAt = new Date();

            let result = await this.toolRegistry.execute(
                tc.name,
                args,
                {
                    ...this.toolContext,
                    sessionId: this.session.id,
                    requestToolApproval,
                    requestQuestion,
                    approvalRequestPatch: createPreToolApprovalPatch(tc.name, args, preHookResult),
                    onToolStream: (event) => {
                        this.emit('tool_update', { requestId: tc.id, chunk: event.chunk, stream: event.stream }, streamId);
                        callbacks?.onToolStream?.(tc.name, event.chunk, event.stream);
                    },
                },
                tc.id,
            );
            result = appendHookFeedback(result, 'PreToolUse', preHookResult.additionalContexts);
            result = await this.applyPostToolHookFeedback(result, {
                toolName: tc.name,
                toolArgs: args,
                toolCallId: tc.id,
                permissionMode: perm,
            });
            const completedAt = new Date();

            try { callbacks?.onToolEnd?.(tc.name, result.output, result.success); } catch { /* UI callback must not crash agent */ }
            this.session.recordToolExecution({
                id: tc.id,
                name: tc.name,
                args,
                success: result.success,
                output: result.output,
                error: result.error,
                startedAt,
                completedAt,
                metadata: result.metadata,
            });

            // Add tool results to session
            const resultContent = result.success
                ? result.output
                : `Error: ${result.error}`;
            this.session.addToolResult(tc.id, resultContent);
            this.emit('tool_response', { requestId: tc.id, name: tc.name, output: resultContent, success: result.success }, streamId);
        }
    }

    private async applyPostToolHookFeedback(
        result: ToolResult,
        input: {
            toolName: string;
            toolArgs: Record<string, unknown>;
            toolCallId: string;
            permissionMode: AgentPermissionMode;
        },
    ): Promise<ToolResult> {
        const eventName = result.success ? 'PostToolUse' : 'PostToolUseFailure';
        const hookResult = await runToolHooks(
            eventName,
            result.success
                ? buildPostToolUseHookPayload({
                    sessionId: this.session.id,
                    cwd: this.toolContext.cwd,
                    projectRoot: this.toolContext.projectRoot,
                    permissionMode: input.permissionMode,
                    toolName: input.toolName,
                    toolInput: input.toolArgs,
                    toolUseId: input.toolCallId,
                    toolResult: result,
                })
                : buildPostToolUseFailureHookPayload({
                    sessionId: this.session.id,
                    cwd: this.toolContext.cwd,
                    projectRoot: this.toolContext.projectRoot,
                    permissionMode: input.permissionMode,
                    toolName: input.toolName,
                    toolInput: input.toolArgs,
                    toolUseId: input.toolCallId,
                    toolResult: result,
                }),
            {
                disableAllHooks: this.disableAllHooks,
                hooks: this.hooks,
                llmConfig: this.llmConfig,
                cwd: this.toolContext.cwd,
                projectRoot: this.toolContext.projectRoot,
                sessionId: this.session.id,
                permissionMode: input.permissionMode,
                logger: this.logger,
            },
        );
        for (const message of hookResult.systemMessages) {
            this.logger.warn(`${eventName} hook message: ${message}`);
        }

        const feedback = [
            ...(hookResult.decision === 'block' && hookResult.reason
                ? [`${eventName} blocked continuation: ${hookResult.reason}`]
                : []),
            ...hookResult.additionalContexts,
        ];
        return appendHookFeedback(result, eventName, feedback);
    }

    private finalizeToolCall(
        toolCall: ToolCall,
        args: Record<string, unknown>,
        result: ToolResult,
        callbacks: AgentCallbacks | undefined,
        streamId: string,
    ): void {
        try { callbacks?.onToolStart?.(toolCall.name, args); } catch { /* noop */ }
        try { callbacks?.onToolEnd?.(toolCall.name, result.output, false); } catch { /* noop */ }
        const errorMessage = result.error ?? 'Unknown tool failure';
        this.session.recordToolExecution({
            id: toolCall.id,
            name: toolCall.name,
            args,
            success: false,
            output: result.output,
            error: errorMessage,
            startedAt: new Date(),
            completedAt: new Date(),
            metadata: result.metadata,
        });
        this.session.addToolResult(toolCall.id, `Error: ${errorMessage}`);
        this.emit('tool_response', { requestId: toolCall.id, name: toolCall.name, output: errorMessage, success: false }, streamId);
    }

    /** Register default tools */
    private registerDefaultTools(lspServers: LSPServerConfig[] = []): void {
        this.toolRegistry.register(new ReadFileTool());
        this.toolRegistry.register(new WriteFileTool());
        this.toolRegistry.register(new PreviewDiffTool());
        this.toolRegistry.register(new SearchCodeTool());
        this.toolRegistry.register(new ListFilesTool());
        this.toolRegistry.register(new GlobFilesTool());
        this.toolRegistry.register(new GrepContentTool());
        this.toolRegistry.register(new SourcegraphTool());
        const lspTools = createDefaultLspTools({
            externalManager: this.lspManager,
            lspServers,
            cwd: this.toolContext.cwd,
            projectRoot: this.toolContext.projectRoot,
        });
        this.toolRegistry.register(lspTools.workspaceSymbols);
        this.toolRegistry.register(lspTools.fileDiagnostics);
        this.toolRegistry.register(lspTools.definition);
        this.toolRegistry.register(lspTools.references);
        this.toolRegistry.register(lspTools.hover);
        this.toolRegistry.register(lspTools.completion);
        this.toolRegistry.register(lspTools.rename);
        this.toolRegistry.register(new RunCommandTool());
        this.toolRegistry.register(new InstallPackageTool());
        this.toolRegistry.register(new ApplyPatchTool());
        this.toolRegistry.register(new RestoreRollbackPointTool());
        this.toolRegistry.register(new FetchUrlTool());
        this.toolRegistry.register(new WebSearchTool());
        this.toolRegistry.register(new SkillTool());
        this.toolRegistry.register(new TodoWriteTool());
        this.toolRegistry.register(new TodoReadTool());
        this.toolRegistry.register(new QuestionTool());
        this.toolRegistry.register(new DiagnosticsTool());
        this.toolRegistry.register(new DelegateTaskTool(this.llmConfig, this.toolRegistry));
    }

    /** Register custom tools */
    registerTool(tool: import('./tools/tool.js').ITool): void {
        this.toolRegistry.register(tool);
    }

    /** Get tool registry */
    getToolRegistry(): ToolRegistry {
        return this.toolRegistry;
    }

    /** Get current session */
    getSession(): AgentSession {
        return this.session;
    }

    private async ensureProvider(): Promise<import('./llm/provider.js').ILLMProvider> {
        if (!this.provider) {
            this.provider = await createLLMProvider(this.llmConfig);
        }
        return this.provider;
    }

    /** Clean up external resources */
    async dispose(): Promise<void> {
        try { await this.lspManager?.dispose(); } catch { /* ignore */ }
        try { await this.mcpManager?.dispose(); } catch { /* ignore */ }
    }

    /** Reset session */
    resetSession(systemPrompt?: string): void {
        this.session = new AgentSession(systemPrompt);
    }

    private async syncMcpTools(): Promise<void> {
        if (!this.mcpManager) {
            return;
        }

        const remoteTools = await this.mcpManager.listTools();
        const nextNames = new Set(remoteTools.map((tool) => tool.definition.name));

        for (const tool of remoteTools) {
            this.toolRegistry.upsert(tool);
        }

        for (const toolName of this.mcpToolNames) {
            if (!nextNames.has(toolName)) {
                this.toolRegistry.remove(toolName);
            }
        }

        this.mcpToolNames.clear();
        for (const toolName of nextNames) {
            this.mcpToolNames.add(toolName);
        }
    }
}

function buildHookBlockedResult(
    toolCallId: string,
    toolName: string,
    hookResult: Awaited<ReturnType<typeof runToolHooks>>,
    args: Record<string, unknown>,
): ToolResult {
    const section = formatHookFeedbackSection('PreToolUse', [
        ...(hookResult.permissionDecisionReason ? [hookResult.permissionDecisionReason] : []),
        ...hookResult.additionalContexts,
        ...(hookResult.stopReason ? [hookResult.stopReason] : []),
    ]);
    const error = hookResult.permissionDecisionReason
        ?? hookResult.stopReason
        ?? `Tool "${toolName}" was denied by PreToolUse hook`;
    return {
        toolCallId,
        success: false,
        output: section ?? '',
        error,
        metadata: {
            hookFeedback: {
                event: 'PreToolUse',
                decision: hookResult.permissionDecision,
                reason: hookResult.permissionDecisionReason,
                additionalContexts: hookResult.additionalContexts,
                args,
            },
        },
    };
}

function buildPermissionDeniedResult(
    toolCallId: string,
    toolName: string,
    additionalContexts: string[],
): ToolResult {
    const error = `Tool "${toolName}" was denied by permission settings (permission: deny)`;
    const section = formatHookFeedbackSection('PreToolUse', additionalContexts);
    return {
        toolCallId,
        success: false,
        output: section ?? '',
        error,
        metadata: additionalContexts.length > 0
            ? {
                hookFeedback: {
                    event: 'PreToolUse',
                    additionalContexts,
                },
            }
            : undefined,
    };
}

function createPreToolApprovalPatch(
    toolName: string,
    args: Record<string, unknown>,
    hookResult: Awaited<ReturnType<typeof runToolHooks>>,
): (Partial<ToolApprovalRequest> & { force?: boolean }) | undefined {
    if (hookResult.permissionDecision !== 'ask' && hookResult.additionalContexts.length === 0 && !hookResult.permissionDecisionReason) {
        return undefined;
    }

    return {
        force: hookResult.permissionDecision === 'ask',
        summary: hookResult.permissionDecision === 'ask'
            ? `PreToolUse hook requires approval before running ${toolName}`
            : undefined,
        reason: formatHookFeedbackSection('PreToolUse', [
            ...(hookResult.permissionDecisionReason ? [hookResult.permissionDecisionReason] : []),
            ...hookResult.additionalContexts,
        ]),
        preview: hookResult.permissionDecision === 'ask'
            ? safeStringifyHookArgs(args)
            : undefined,
        risk: hookResult.permissionDecision === 'ask' ? 'high' : undefined,
    };
}

function appendHookFeedback(result: ToolResult, label: string, feedback: string[]): ToolResult {
    const section = formatHookFeedbackSection(label, feedback);
    if (!section) {
        return result;
    }
    return {
        ...result,
        output: result.output ? `${result.output}\n\n${section}` : section,
        ...(result.error ? { error: `${result.error}\n\n${section}` } : {}),
        metadata: {
            ...(result.metadata ?? {}),
            hookFeedback: {
                ...(typeof result.metadata?.['hookFeedback'] === 'object' && result.metadata['hookFeedback'] !== null
                    ? result.metadata['hookFeedback'] as Record<string, unknown>
                    : {}),
                event: label,
                additionalContexts: feedback,
            },
        },
    };
}

function safeStringifyHookArgs(args: Record<string, unknown>): string {
    try {
        return JSON.stringify(args, null, 2);
    } catch {
        return '[unserializable tool arguments]';
    }
}
