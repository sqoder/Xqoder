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
    HooksSettings,
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
import { buildLocalFallbackGuidance } from '../../shared/local-fallback.js';
import type { ILLMProvider } from './llm/provider.js';
import { ExternalLanguageServerManager } from './lsp-manager.js';
import { McpServerManager } from './mcp.js';
import { MvpRuntimeController } from './mvp/orchestrator.js';
import { loadMvpRuntimeConfig } from './mvp/runtime-config.js';
import type { AgentRuntimeProfile, MvpRuntimeConfig } from './mvp/types.js';
import { ToolRegistry, type ITool, type QuestionAnswer, type QuestionPrompt, type ToolApprovalRequest, type ToolContext } from './tools/tool.js';
import { FileRollbackStore, type RollbackStore } from './tools/rollback-store.js';
import { registerDefaultAgentTools } from './agent-default-tools.js';
import { executeAgentToolCalls } from './agent-tool-execution.js';
import { syncDynamicMcpTools } from './agent-tool-sync.js';
import { AgentSession } from './session/session.js';
import {
    type AgentProtocol,
    type AgentEvent,
    type AgentEvents,
    type Unsubscribe,
    type AgentSend,
} from './protocol.js';

/** Agent Configuration */
export interface AgentConfig {
    agentName?: string;
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
    /** Runtime execution profile; mvp isolates the default loop to the closed-loop core */
    runtimeProfile?: AgentRuntimeProfile;
    /** Project context rule files (CLAUDE.md / xqoder.md / etc.) */
    contextPaths?: string[];
    /** Test seam for injecting a provider */
    providerFactory?: (config: LLMProviderConfig) => Promise<ILLMProvider> | ILLMProvider;
}

/** Agent runtime callbacks */
/** Agent runtime callbacks */
export interface AgentCallbacks extends StreamCallbacks {
    /** Low-level runtime events emitted during the run */
    onEvent?: (event: AgentEvent) => void;
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

export const DEFAULT_MVP_SYSTEM_PROMPT = `You are XQoder, an AI programming assistant operating in MVP runtime mode. You can:
- Read files
- Search code
- Write files
- Execute shell commands

Core behavior:
- Work in a closed loop: inspect -> change -> verify -> continue until verified
- Prefer the smallest safe change that solves the task
- Read/search before editing
- Do not claim success before the runtime verifier passes after file writes

Output Style Requirements:
- Use concise and straightforward text
- Do not use emojis or decorative symbols
- Use "-" as a standard list symbol only when necessary`;

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
    private provider?: ILLMProvider;
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
    private readonly agentName?: string;
    private readonly autoApproveTools: boolean;
    private readonly permissions?: PermissionSettings;
    private readonly disableAllHooks: boolean;
    private readonly hooks?: HooksSettings;
    private readonly compaction?: CompactionConfig;
    private readonly runtimeProfile: AgentRuntimeProfile;
    private readonly mvpRuntimeConfig?: MvpRuntimeConfig;
    private readonly contextPaths: string[];
    private readonly providerFactory?: AgentConfig['providerFactory'];
    private activeCallbacks?: AgentCallbacks;
    private activeAbort?: AbortController;
    private subscribers = new Set<(event: AgentEvent) => void>();
    private eventHistory: AgentEvent[] = [];

    constructor(config: AgentConfig) {
        this.llmConfig = config.llmConfig;
        this.agentName = config.agentName;
        this.runtimeProfile = config.runtimeProfile ?? 'full';
        this.contextPaths = config.contextPaths ?? [];
        this.providerFactory = config.providerFactory;
        // Provider will be initialized lazily in ensureProvider()

        // Initialize tool registry
        this.toolRegistry = new ToolRegistry();

        // Initialize session
        this.session = config.session ?? new AgentSession({
            systemPrompt: config.systemPrompt ?? (
                this.runtimeProfile === 'mvp'
                    ? DEFAULT_MVP_SYSTEM_PROMPT
                    : DEFAULT_SYSTEM_PROMPT
            ),
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
        this.mvpRuntimeConfig = this.runtimeProfile === 'mvp' || this.runtimeProfile === 'hybrid'
            ? loadMvpRuntimeConfig(projectRoot)
            : undefined;
        this.rollbackStore = config.rollbackStore ?? new FileRollbackStore(getXQoderPaths().rollbackDir);
        this.toolContext = {
            cwd: path.resolve(config.cwd ?? projectRoot),
            projectRoot,
            sandboxMode: config.sandboxMode ?? 'project',
            allowedPaths: (config.allowedPaths ?? []).map((entry) => path.resolve(entry)),
            shell: config.shell,
            rollbackStore: this.rollbackStore,
            ...(this.mvpRuntimeConfig ? { mvpRuntimeConfig: this.mvpRuntimeConfig } : {}),
        };
        this.logger = defaultLogger.child('Agent');
        if (this.runtimeProfile !== 'mvp' && (config.mcpServers ?? []).some((server) => server.enabled !== false)) {
            this.mcpManager = new McpServerManager({
                servers: config.mcpServers ?? [],
                cwd: this.toolContext.cwd,
                projectRoot,
                sandboxMode: this.toolContext.sandboxMode,
                allowedPaths: this.toolContext.allowedPaths,
                logger: this.logger,
            });
        }
        if (this.runtimeProfile !== 'mvp' && (config.lspServers ?? []).some((server) => server.enabled !== false)) {
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
        try {
            this.activeCallbacks?.onEvent?.(event);
        } catch {
            // callback failures must not crash the agent
        }
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
        this.activeCallbacks = callbacks;

        this.emit('agent_start', { streamId }, streamId);
        this.emit('message', { role: 'user', content: userMessage }, streamId);

        const provider = await this.ensureProvider();
        this.session.addUserMessage(userMessage, attachments);
        const toolHistoryBaseline = this.session.getToolHistory().length;
        this.logger.info(`User request: ${userMessage.slice(0, 100)}...`);
        const mvpRuntime = this.runtimeProfile === 'mvp' || this.runtimeProfile === 'hybrid'
            ? new MvpRuntimeController({
                userGoal: userMessage,
                projectRoot: this.toolContext.projectRoot,
                contextPaths: this.contextPaths,
                shell: this.toolContext.shell,
                session: this.session,
                rollbackStore: this.rollbackStore,
                runtimeProfile: this.runtimeProfile,
                runtimeConfig: this.mvpRuntimeConfig,
            })
            : undefined;

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
            if (this.runtimeProfile !== 'mvp') {
                try { await this.syncMcpTools(); } catch { /* MCP sync failure is non-fatal */ }
            }
            const forcedStopMessage = mvpRuntime?.getForcedStopMessage();
            if (forcedStopMessage) {
                this.logger.warn(`MVP runtime forced stop: ${forcedStopMessage}`);
                this.emit('agent_end', { streamId, reason: 'completed' }, streamId);
                return forcedStopMessage;
            }

            // Build request
            const request: CompletionRequest = {
                messages: mvpRuntime ? mvpRuntime.prepareMessages() : this.session.getMessages(),
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
                const error = err instanceof Error ? err : new Error(String(err));
                const baseMessage = `LLM call failed: ${error.message}`;
                const guidance = await buildLocalFallbackGuidance({
                    error: new Error(baseMessage),
                    llmConfig: this.llmConfig,
                    agentName: this.agentName,
                });
                const msg = guidance ? `${baseMessage}\n\n${guidance}` : baseMessage;
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
            if (
                this.runtimeProfile !== 'mvp'
                && this.compaction?.auto !== false
                && ctxWindow
                && response.usage.promptTokens >= ctxWindow * 0.85
            ) {
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

            const completionBlocker = response.finishReason === 'tool_calls'
                ? undefined
                : mvpRuntime?.getCompletionBlocker();

            if (!completionBlocker || response.finishReason === 'tool_calls') {
                this.session.addAssistantMessage(response.message);
            }

            // Check if there are tool calls
            if (response.finishReason === 'tool_calls' && response.message.toolCalls) {
                await this.executeToolCalls(response.message.toolCalls, callbacks, streamId);
                await mvpRuntime?.runPostToolVerification();
                // Continue loop, let LLM handle tool results
                continue;
            }

            if (completionBlocker) {
                this.session.addMessage({
                    role: 'system',
                    content: completionBlocker,
                });
                continue;
            }

            const noToolCompletionBlocker = mvpRuntime?.getNoToolCompletionBlocker(
                this.session.getToolHistory().length > toolHistoryBaseline,
            );
            if (noToolCompletionBlocker) {
                this.session.addMessage({
                    role: 'system',
                    content: noToolCompletionBlocker,
                });
                continue;
            }

            // No tool calls, Agent complete
            this.logger.success(`Agent completed in ${iteration} iterations`);
            this.emit('agent_end', { streamId, reason: 'completed' }, streamId);
            return mvpRuntime?.finalizeAssistantResponse(response.message.content) ?? response.message.content;
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
            this.activeCallbacks = undefined;
            this.activeAbort = undefined;
        }
    }

    /** Execute tool calls */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        callbacks?: AgentCallbacks,
        streamId: string = 'global'
    ): Promise<void> {
        await executeAgentToolCalls(
            {
                toolRegistry: this.toolRegistry,
                session: this.session,
                toolContext: this.toolContext,
                logger: this.logger,
                llmConfig: this.llmConfig,
                autoApproveTools: this.autoApproveTools,
                permissions: this.permissions,
                disableAllHooks: this.disableAllHooks || this.runtimeProfile === 'mvp',
                hooks: this.runtimeProfile === 'mvp' ? undefined : this.hooks,
                emit: this.emit.bind(this),
            },
            toolCalls,
            callbacks,
            streamId,
        );
    }

    /** Register default tools */
    private registerDefaultTools(lspServers: LSPServerConfig[] = []): void {
        registerDefaultAgentTools({
            toolRegistry: this.toolRegistry,
            toolContext: this.toolContext,
            llmConfig: this.llmConfig,
            lspManager: this.lspManager,
            lspServers,
            profile: this.runtimeProfile,
        });
    }

    /** Register custom tools */
    registerTool(tool: ITool): void {
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

    private async ensureProvider(): Promise<ILLMProvider> {
        if (!this.provider) {
            this.provider = this.providerFactory
                ? await this.providerFactory(this.llmConfig)
                : await createLLMProvider(this.llmConfig);
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
        this.session = new AgentSession(
            systemPrompt
            ?? (this.runtimeProfile === 'mvp' ? DEFAULT_MVP_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT),
        );
    }

    private async syncMcpTools(): Promise<void> {
        await syncDynamicMcpTools({
            mcpManager: this.mcpManager,
            toolRegistry: this.toolRegistry,
            trackedToolNames: this.mcpToolNames,
        });
    }
}
