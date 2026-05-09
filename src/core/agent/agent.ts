// XQoderAgent Core Class
// ============================================================

import type {
    ApprovalPolicy,
    ExecutionCapability,
    LLMProviderConfig,
    MessageAttachment,
    LSPServerConfig,
    MCPServerConfig,
    StreamCallbacks,
    ToolCall,
    SandboxMode,
    ShellConfig,
    TaskMode,
    PermissionSettings,
    ToolResult,
    HooksSettings,
} from '@xqoder/shared';
import { logger as defaultLogger, Logger, type CompactionConfig } from '@xqoder/shared';
import { getXQoderPaths } from '@xqoder/shared';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    createLLMProvider,
} from './llm/factory.js';
import type { ILLMProvider } from './llm/provider.js';
import { ExternalLanguageServerManager } from './lsp-manager.js';
import { McpServerManager } from './mcp.js';
import { createMvpConversationRuntime } from './mvp/conversation-runtime.js';
import { loadMvpRuntimeConfig } from './mvp/runtime-config.js';
import type { AgentRuntimeProfile, MvpRuntimeConfig } from './mvp/types.js';
import { ToolRegistry, type ITool, type QuestionAnswer, type QuestionPrompt, type ToolApprovalRequest, type ToolContext } from './tools/tool.js';
import { FileRollbackStore, type RollbackStore } from './tools/rollback-store.js';
import { registerDefaultAgentTools } from './agent-default-tools.js';
import { executeAgentToolCalls } from './agent-tool-execution.js';
import {
    finalizePreparedAgentToolCall,
    invokePreparedAgentToolCall,
    prepareAgentToolCall,
} from './agent-tool-execution.js';
import { syncDynamicMcpTools } from './agent-tool-sync.js';
import { AgentSession } from './session/session.js';
import {
    isToolVisibleForExecutionCapability,
    resolveToolPermissionMode,
} from '../../domain/permissions/index.js';
import {
    type AgentProtocol,
    type AgentEvent,
    type AgentEvents,
    type Unsubscribe,
    type AgentSend,
} from './protocol.js';
import {
    ConversationEngineStopError,
    runConversationTurn,
    streamConversationTurn,
} from '../../application/chat/conversation-engine.js';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

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
    taskMode?: TaskMode;
    executionCapability?: ExecutionCapability;
    approvalPolicy?: ApprovalPolicy;
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
export interface AgentCallbacks extends StreamCallbacks {
    /** Low-level runtime events emitted during the run */
    onEvent?: (event: AgentEvent) => void;
    /** Turn-level stop reason emitted when the run reaches a terminal state */
    onStop?: (stopReason: ConversationStopReason) => void;
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
- Built-in read-only tools (read_file, list_files, search_code, grep_content, glob_files, diagnostics, and LSP read/navigation tools) may inspect user-requested paths directly, including outside the project directory, unless the runtime returns an explicit read-denied or sandbox error
- Use read_any_file for PDFs, Office documents, images, and unknown/binary files; use read_file ranges for large plain text/code files
- If read_any_file reports that document/PDF/image content was not extracted, do not infer or summarize the file from its file name or path alone
- For read-only inspection, do not ask the user to confirm first and do not ask them to paste file contents; call the appropriate read/list/search tool and continue
- Write, edit, shell, network, MCP, and other side-effectful operations remain governed by the permission system and may require approval
- If the user explicitly requests a side-effectful operation outside the project directory (e.g., Desktop, Downloads, system paths), attempt the requested target path and let the permission system decide instead of substituting a project-internal workaround`;

export const DEFAULT_MVP_SYSTEM_PROMPT = `You are XQoder, an AI programming assistant operating in MVP runtime mode. You can:
- Read files
- List and glob project files
- Search code
- Write files
- Execute shell commands

Core behavior:
- Work in a closed loop: inspect -> change -> verify -> continue until verified
- Prefer the smallest safe change that solves the task
- Read/search before editing
- Built-in read/list/search tools can inspect concrete user-requested paths directly without asking for confirmation first
- When the user gives a directory path and asks what the project is, inspect the directory with list_files or glob_files before reading key files
- Do not claim success before the runtime verifier passes after file writes

Output Style Requirements:
- Use concise and straightforward text
- Match the user's language; if the user writes in Chinese or asks for Chinese, answer in Chinese
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
    private readonly taskMode?: TaskMode;
    private readonly executionCapability: ExecutionCapability;
    private readonly disableAllHooks: boolean;
    private readonly hooks?: HooksSettings;
    private readonly compaction?: CompactionConfig;
    private readonly runtimeProfile: AgentRuntimeProfile;
    private readonly mvpRuntimeConfig?: MvpRuntimeConfig;
    private readonly contextPaths: string[];
    private readonly providerFactory?: AgentConfig['providerFactory'];
    private readonly sessionResumed: boolean;
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
        this.sessionResumed = Boolean(config.session);

        this.maxIterations = config.maxIterations ?? 20;
        this.autoApproveTools = config.autoApproveTools ?? false;
        this.permissions = config.permissions;
        this.taskMode = config.taskMode;
        this.executionCapability = config.executionCapability
            ?? inferExecutionCapability(config.agentName, this.runtimeProfile);
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
            fileReadState: new Map(),
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

    /**
     * Compatibility wrapper over the application-layer conversation engine.
     * Keep the public AgentProtocol contract stable while turn execution lives in application/chat.
     */
    async run(userMessage: string, callbacks?: AgentCallbacks, attachments: MessageAttachment[] = [], streamId: string = randomUUID()): Promise<string> {
        this.activeAbort?.abort();
        const abort = new AbortController();
        this.activeAbort = abort;
        this.activeCallbacks = callbacks;

        this.emit('agent_start', { streamId }, streamId);
        this.emit('message', { role: 'user', content: userMessage }, streamId);

        try {
            const result = await runConversationTurn({
                provider: await this.ensureProvider(),
                session: this.session,
                userMessage,
                attachments,
                callbacks,
                streamId,
                abortSignal: abort.signal,
                logger: this.logger,
                llmConfig: this.llmConfig,
                agentName: this.agentName,
                runtimeProfile: this.runtimeProfile,
                maxTurns: this.maxIterations,
                compaction: this.compaction,
                cwd: this.toolContext.cwd,
                sessionResumed: this.sessionResumed,
                emit: this.emit.bind(this),
                taskMode: this.taskMode,
                getToolDefinitions: () => this.toolRegistry.getTools()
                    .filter((tool) => isToolVisibleForExecutionCapability(
                        tool.definition.name,
                        this.executionCapability,
                        tool.getSecurityPolicyContext?.(),
                    ))
                    .map((tool) => tool.definition),
                toolExecutionPort: this.createToolExecutionPort(),
                executeToolCalls: (toolCalls, callbackSet, activeStreamId) => this.executeToolCalls(
                    toolCalls,
                    callbackSet as AgentCallbacks | undefined,
                    activeStreamId,
                ),
                syncMcpTools: this.syncMcpTools.bind(this),
                createRuntime: () => this.createMvpRuntime(userMessage),
            });
            try { callbacks?.onStop?.(result.stopReason); } catch { /* noop */ }
            return result.response;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof ConversationEngineStopError) {
                try { callbacks?.onStop?.(err.stopReason); } catch { /* noop */ }
                this.emit('agent_end', {
                    streamId,
                    reason: err.agentEndReason,
                    summary: err.stopReason,
                }, streamId);
            } else {
                this.emit('error', { message: msg, fatal: false }, streamId);
                this.emit('agent_end', { streamId, reason: 'error' }, streamId);
            }
            throw err;
        } finally {
            this.activeCallbacks = undefined;
            this.activeAbort = undefined;
        }
    }

    streamTurn(
        userMessage: string,
        callbacks?: AgentCallbacks,
        attachments: MessageAttachment[] = [],
        streamId: string = randomUUID(),
    ) {
        this.activeAbort?.abort();
        const abort = new AbortController();
        this.activeAbort = abort;
        this.activeCallbacks = callbacks;

        this.emit('agent_start', { streamId }, streamId);
        this.emit('message', { role: 'user', content: userMessage }, streamId);

        const self = this;
        return {
            async *[Symbol.asyncIterator]() {
                try {
                    const provider = await self.ensureProvider();
                    const stream = streamConversationTurn({
                        provider,
                        session: self.session,
                        userMessage,
                        attachments,
                        callbacks,
                        streamId,
                        abortSignal: abort.signal,
                        logger: self.logger,
                        llmConfig: self.llmConfig,
                        agentName: self.agentName,
                        runtimeProfile: self.runtimeProfile,
                        maxTurns: self.maxIterations,
                        compaction: self.compaction,
                        cwd: self.toolContext.cwd,
                        sessionResumed: self.sessionResumed,
                        emit: self.emit.bind(self),
                        taskMode: self.taskMode,
                        getToolDefinitions: () => self.toolRegistry.getTools()
                            .filter((tool) => isToolVisibleForExecutionCapability(
                                tool.definition.name,
                                self.executionCapability,
                                tool.getSecurityPolicyContext?.(),
                            ))
                            .map((tool) => tool.definition),
                        toolExecutionPort: self.createToolExecutionPort(),
                        executeToolCalls: (toolCalls, callbackSet, activeStreamId) => self.executeToolCalls(
                            toolCalls,
                            callbackSet as AgentCallbacks | undefined,
                            activeStreamId,
                        ),
                        syncMcpTools: self.syncMcpTools.bind(self),
                        createRuntime: () => self.createMvpRuntime(userMessage),
                    });

                    for await (const event of stream) {
                        yield event;
                    }
                } finally {
                    self.activeCallbacks = undefined;
                    self.activeAbort = undefined;
                }
            },
        };
    }

    /** Execute tool calls */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        callbacks?: AgentCallbacks,
        streamId: string = 'global'
    ): Promise<ToolResult[]> {
        return await executeAgentToolCalls(
            {
                toolRegistry: this.toolRegistry,
                session: this.session,
                toolContext: this.toolContext,
                logger: this.logger,
                llmConfig: this.llmConfig,
                autoApproveTools: this.autoApproveTools,
                permissions: this.permissions,
                executionCapability: this.executionCapability,
                disableAllHooks: this.disableAllHooks || this.runtimeProfile === 'mvp',
                hooks: this.runtimeProfile === 'mvp' ? undefined : this.hooks,
                emit: this.emit.bind(this),
            },
            toolCalls,
            callbacks,
            streamId,
        );
    }

    private createToolExecutionPort() {
        return {
            prepareToolCall: (input: {
                toolCall: ToolCall;
                callbacks?: AgentCallbacks;
                streamId: string;
            }) => prepareAgentToolCall(
                {
                    toolRegistry: this.toolRegistry,
                    session: this.session,
                    toolContext: this.toolContext,
                    logger: this.logger,
                    llmConfig: this.llmConfig,
                    autoApproveTools: this.autoApproveTools,
                    permissions: this.permissions,
                    executionCapability: this.executionCapability,
                    disableAllHooks: this.disableAllHooks || this.runtimeProfile === 'mvp',
                    hooks: this.runtimeProfile === 'mvp' ? undefined : this.hooks,
                    emit: this.emit.bind(this),
                },
                input.toolCall,
                input.callbacks,
                input.streamId,
            ),
            invokePreparedToolCall: invokePreparedAgentToolCall,
            finalizeToolCall: finalizePreparedAgentToolCall,
        };
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

    async listVisibleTools(): Promise<Array<{ name: string; description?: string; permissionMode: string }>> {
        try {
            await this.syncMcpTools();
        } catch {
            // Tool discovery should stay best-effort for direct commands.
        }

        return this.toolRegistry.getTools()
            .filter((tool) => isToolVisibleForExecutionCapability(
                tool.definition.name,
                this.executionCapability,
                tool.getSecurityPolicyContext?.(),
            ))
            .map((tool) => ({
                name: tool.definition.name,
                ...(tool.definition.description ? { description: tool.definition.description } : {}),
                permissionMode: resolveToolPermissionMode(
                    tool.definition.name,
                    this.permissions,
                    tool.getSecurityPolicyContext?.(),
                ),
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
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

    private createMvpRuntime(userMessage: string) {
        return this.runtimeProfile === 'mvp' || this.runtimeProfile === 'hybrid'
            ? createMvpConversationRuntime({
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
    }

    private async syncMcpTools(): Promise<void> {
        await syncDynamicMcpTools({
            mcpManager: this.mcpManager,
            toolRegistry: this.toolRegistry,
            trackedToolNames: this.mcpToolNames,
        });
    }
}

function inferExecutionCapability(
    agentName: string | undefined,
    runtimeProfile: AgentRuntimeProfile,
): ExecutionCapability {
    if (agentName === 'plan') {
        return 'plan';
    }

    if (agentName === 'explore' || agentName === 'summary' || agentName === 'title' || agentName === 'compaction') {
        return 'read_only';
    }

    return runtimeProfile === 'mvp' ? 'read_only' : 'workspace_write';
}
