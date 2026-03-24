// ============================================================
// XQoderAgent 核心类
// ============================================================

import type {
    LLMProviderConfig,
    MessageAttachment,
    LLMMessage,
    LSPServerConfig,
    MCPServerConfig,
    StreamCallbacks,
    ToolCall,
    SandboxMode,
    ShellConfig,
    PermissionSettings,
    AgentPermissionMode,
    CompactionConfig,
} from '@xqoder/shared';
import {
    AgentError,
    logger as defaultLogger,
    Logger,
    calculateCost,
    getContextWindow,
    resolveToolPermissionMode,
} from '@xqoder/shared';
import { getXQoderPaths } from '@xqoder/shared';
import * as path from 'node:path';
import type { ILLMProvider, CompletionRequest } from './llm/provider.js';
import { OpenAIProvider, AnthropicProvider } from './llm/providers/index.js';
import { DashScopeProvider } from './llm/dashscope.js';
import { GeminiProvider } from './llm/gemini.js';
import { AzureOpenAIProvider } from './llm/azure.js';
import { BedrockProvider } from './llm/bedrock.js';
import { CopilotProvider } from './llm/copilot.js';
import { VertexAIProvider } from './llm/vertexai.js';
import { GroqProvider } from './llm/groq.js';
import { OpenRouterProvider } from './llm/openrouter.js';
import { LocalProvider } from './llm/local.js';
import { XAIProvider } from './llm/xai.js';
import { ZhipuProvider } from './llm/zhipu.js';
import { ExternalLanguageServerManager } from './lsp.js';
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
import { AgentSession, type AgentSessionSnapshot } from './session/session.js';

/** Agent 配置 */
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
    /** OpenCode 风格：按权限键 allow/ask/deny，在工具执行前短路 */
    permissions?: PermissionSettings;
    /** 会话压缩配置 */
    compaction?: CompactionConfig;
}

/** Agent 运行回调 */
export interface AgentCallbacks extends StreamCallbacks {
    /** 工具执行开始 */
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    /** 工具执行完成 */
    onToolEnd?: (name: string, result: string, success: boolean, metadata?: Record<string, unknown>) => void;
    /** 工具执行过程中的流式输出 */
    onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
    /** 工具执行前审批 */
    onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean> | boolean;
    /** 结构化提问 */
    onQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer> | QuestionAnswer;
    /** 迭代计数 */
    onIteration?: (count: number) => void;
}

/** 默认 system prompt */
export const DEFAULT_SYSTEM_PROMPT = `你是 XQoder，一个 AI 编程助手。你可以：
- 读写文件
- 搜索代码
- 读取 TypeScript/JavaScript 符号、定义、引用和诊断
- 通过外部 Language Server 读取多语言符号、定义、引用和诊断
- 读取 hover、completion，并按需做安全的符号 rename
- 执行终端命令
- 安装依赖包
- 调用外部 MCP 工具
- 读取 MCP resources 和 prompts
- 委派研究任务给子 agent（delegate_task），让它们帮你探索代码库
- 加载技能文档（skill）
- 记录/读取任务清单（todowrite / todoread）
- 发起结构化提问（question）

请根据用户的需求，使用工具来完成编程任务。每次操作后请验证结果。
如果遇到错误，请分析原因并尝试修复。
对于需要大量探索代码库的任务（如查找所有使用、理解模块架构等），使用 delegate_task 委派给子 agent。
输出风格要求：
- 使用简洁直白的文本
- 不要使用 emoji 或装饰性符号
- 仅在必要时使用 "-" 作为普通列表符号

权限与路径策略（非常重要）：
- 默认在项目目录内操作
- 如果用户明确要求操作项目目录之外的路径（例如桌面、下载目录、系统路径），不要直接拒绝，也不要改成“先写到项目里再复制”的替代方案
- 直接按用户要求尝试目标路径，让工具触发权限审批弹窗，由用户决定是否放行
- 当用户表达“让你操作整台电脑/给你全部权限”时，优先触发权限审批流程并等待用户选择`;

export function createLLMProvider(config: LLMProviderConfig): ILLMProvider {
    switch (config.provider) {
        case 'openai':
        case 'openai-compatible':
            return new OpenAIProvider(config);
        case 'anthropic':
            return new AnthropicProvider(config);
        case 'dashscope':
            return new DashScopeProvider(config);
        case 'gemini':
            return new GeminiProvider(config);
        case 'azure':
            return new AzureOpenAIProvider(config);
        case 'bedrock':
            return new BedrockProvider(config);
        case 'copilot':
            return new CopilotProvider(config);
        case 'vertexai':
            return new VertexAIProvider(config);
        case 'groq':
            return new GroqProvider(config);
        case 'openrouter':
            return new OpenRouterProvider(config);
        case 'local':
            return new LocalProvider(config);
        case 'xai':
            return new XAIProvider(config);
        case 'zhipu':
            return new ZhipuProvider(config);
        default:
            throw new AgentError(`不支持的 LLM Provider: ${String(config.provider)}`);
    }
}

/**
 * XQoderAgent 核心类
 *
 * 负责：
 * 1. 管理 LLM Provider
 * 2. 注册和调度工具
 * 3. 维护会话上下文
 * 4. 执行 Agent Loop（消息 → LLM → 工具调用 → 结果反馈 → 循环）
 */
export class XQoderAgent {
    private provider: ILLMProvider;
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
    private readonly compaction?: CompactionConfig;
    private activeAbort?: AbortController;

    constructor(config: AgentConfig) {
        this.llmConfig = config.llmConfig;
        this.provider = createLLMProvider(config.llmConfig);

        // 初始化工具注册表
        this.toolRegistry = new ToolRegistry();

        // 初始化会话
        this.session = config.session
            ? AgentSession.fromSnapshot(config.session.toSnapshot())
            : new AgentSession({
                systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
                title: config.sessionTitle,
            });
        if (!config.session && config.sessionTitle) {
            this.session.setTitle(config.sessionTitle);
        }

        this.maxIterations = config.maxIterations ?? 20;
        this.autoApproveTools = config.autoApproveTools ?? false;
        this.permissions = config.permissions;
        this.compaction = config.compaction;
        this.session.setCompactionReservedMessages(this.compaction?.reserved);
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
    }

    /**
     * 运行 Agent
     * 发送用户消息，进入 Agent Loop 直到完成或达到最大迭代次数
     */
    /** 取消正在运行的 agent */
    cancel(): void {
        this.activeAbort?.abort();
        this.activeAbort = undefined;
    }

    /** 当前是否有运行中的请求 */
    get isRunning(): boolean {
        return this.activeAbort !== undefined && !this.activeAbort.signal.aborted;
    }

    async run(userMessage: string, callbacks?: AgentCallbacks, attachments: MessageAttachment[] = []): Promise<string> {
        this.activeAbort?.abort();
        const abort = new AbortController();
        this.activeAbort = abort;

        this.session.addUserMessage(userMessage, attachments);
        this.logger.info(`用户请求: ${userMessage.slice(0, 100)}...`);

        let iteration = 0;

        try {
        while (iteration < this.maxIterations) {
            if (abort.signal.aborted) {
                this.logger.warn('Agent 被用户取消');
                return '[cancelled by user]';
            }

            iteration++;
            try { callbacks?.onIteration?.(iteration); } catch { /* UI callback failure */ }
            this.logger.debug(`迭代 ${iteration}/${this.maxIterations}`);
            try { await this.syncMcpTools(); } catch { /* MCP sync failure is non-fatal */ }

            // 构建请求
            const request: CompletionRequest = {
                messages: this.session.getMessages(),
                tools: this.toolRegistry.getDefinitions(),
            };

            // 调用 LLM
            let response;
            try {
                if (callbacks?.onToken) {
                    response = await this.provider.stream(request, callbacks);
                } else {
                    response = await this.provider.complete(request);
                }
            } catch (err) {
                throw new AgentError(
                    `LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`,
                );
            }

            // Cost tracking
            const cost = calculateCost(this.llmConfig.model, response.usage);
            this.session.recordUsage({ ...response.usage, cost });

            // Auto-compact: if context usage ≥ 85%, trigger summarization (like Open Code / Claude Code)
            const ctxWindow = getContextWindow(this.llmConfig.model);
            if (this.compaction?.auto !== false && ctxWindow && response.usage.promptTokens >= ctxWindow * 0.85) {
                this.logger.warn(`Context usage at ${Math.round(response.usage.promptTokens / ctxWindow * 100)}%, triggering auto-compact`);
                try {
                    const plan = this.session.createCompactionPlan({
                        reservedMessages: this.compaction?.reserved,
                    });
                    if (plan.compactedMessages.length === 0) {
                        this.logger.warn('Auto-compact skipped because no historical messages were eligible for summarization');
                    } else {
                    const summaryAgent = new (await import('./sub-agents.js')).SummarizerAgent(this.llmConfig);
                        const summary = await summaryAgent.summarizeForCompaction({
                            priorSummary: plan.priorSummary,
                            compactedMessages: plan.compactedMessages,
                            recentMessages: plan.recentMessages,
                        });
                        this.session.performCompaction(summary, {
                            reservedMessages: this.compaction?.reserved,
                        });
                        try { callbacks?.onToolEnd?.('auto_compact', summary, true); } catch { /* ignore */ }
                    }
                } catch (err) {
                    this.logger.error(`Auto-compact failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            // 保存助手消息
            this.session.addAssistantMessage(response.message);

            // 检查是否有工具调用
            if (response.finishReason === 'tool_calls' && response.message.toolCalls) {
                await this.executeToolCalls(response.message.toolCalls, callbacks);
                // 继续循环，让 LLM 处理工具结果
                continue;
            }

            // 没有工具调用，Agent 完成
            this.logger.success(`Agent 完成，共 ${iteration} 次迭代`);
            return response.message.content;
        }

        throw new AgentError(`达到最大迭代次数 (${this.maxIterations})`);
        } finally {
            this.activeAbort = undefined;
        }
    }

    /** 执行工具调用 */
    private async executeToolCalls(
        toolCalls: ToolCall[],
        callbacks?: AgentCallbacks,
    ): Promise<void> {
        const PARALLEL_TOOLS = new Set([
            'read_file',
            'search_code',
            'grep_content',
            'glob_files',
            'fetch_url',
            'websearch',
        ]);

        const parsed = toolCalls.map((tc) => {
            let args: Record<string, unknown>;
            try {
                args = (tc.arguments ? JSON.parse(tc.arguments) : {}) as Record<string, unknown>;
            } catch {
                args = {};
                this.logger.warn(`工具 ${tc.name} 参数解析失败: ${tc.arguments?.slice(0, 100)}`);
            }
            const perm = resolveToolPermissionMode(tc.name, this.permissions);
            const canAutoApprove = perm === 'allow' || this.autoApproveTools;
            const parallelizable = canAutoApprove && PARALLEL_TOOLS.has(tc.name);
            return { tc, args, perm, parallelizable };
        });

        const executeOne = async (tc: ToolCall, args: Record<string, unknown>, perm: AgentPermissionMode) => {
            this.logger.info(`调用工具: ${tc.name}`);

            if (perm === 'deny') {
                const error = `工具 "${tc.name}" 已被权限配置拒绝 (permission: deny)`;
                try { callbacks?.onToolStart?.(tc.name, args); } catch { /* noop */ }
                try { callbacks?.onToolEnd?.(tc.name, '', false); } catch { /* noop */ }
                this.session.recordToolExecution({
                    id: tc.id,
                    name: tc.name,
                    args,
                    success: false,
                    output: '',
                    error,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                return { toolCallId: tc.id, resultContent: `错误: ${error}` };
            }

            const requestToolApproval =
                perm === 'allow' || this.autoApproveTools
                    ? async () => true
                    : callbacks?.onToolApproval
                        ? (request: ToolApprovalRequest) => Promise.resolve(callbacks.onToolApproval?.(request) ?? false)
                        : async () => false;
            const requestQuestion = callbacks?.onQuestion
                ? (prompt: QuestionPrompt) => Promise.resolve(callbacks.onQuestion?.(prompt) ?? {
                    requestId: prompt.requestId,
                    selected: [],
                })
                : undefined;

            try { callbacks?.onToolStart?.(tc.name, args); } catch { /* UI callback must not crash agent */ }
            const startedAt = new Date();

            const result = await this.toolRegistry.execute(
                tc.name,
                args,
                {
                    ...this.toolContext,
                    sessionId: this.session.id,
                    requestToolApproval,
                    requestQuestion,
                    onToolStream: callbacks?.onToolStream
                        ? (event) => callbacks.onToolStream?.(tc.name, event.chunk, event.stream)
                        : undefined,
                },
                tc.id,
            );
            const completedAt = new Date();

            // metadata 可选（用于 TUI diff/rollback 等交互）
            try {
                callbacks?.onToolEnd?.(
                    tc.name,
                    result.output,
                    result.success,
                    {
                        ...(result.metadata as Record<string, unknown> | undefined),
                        toolCallId: tc.id,
                    },
                );
            } catch { /* UI callback must not crash agent */ }
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

            const resultContent = result.success ? result.output : `错误: ${result.error}`;
            return { toolCallId: tc.id, resultContent };
        };

        // 以“连续可并行段”为单位做 Promise.all；其余保持串行，保证副作用与审批行为稳定
        let index = 0;
        while (index < parsed.length) {
            const start = index;
            const isParallelSegment = parsed[index]!.parallelizable;
            while (index < parsed.length && parsed[index]!.parallelizable === isParallelSegment) {
                index += 1;
            }
            const segment = parsed.slice(start, index);

            if (isParallelSegment) {
                const results = await Promise.all(
                    segment.map((item) => executeOne(item.tc, item.args, item.perm)),
                );
                for (const r of results) {
                    this.session.addToolResult(r.toolCallId, r.resultContent);
                }
                continue;
            }

            for (const item of segment) {
                const r = await executeOne(item.tc, item.args, item.perm);
                this.session.addToolResult(r.toolCallId, r.resultContent);
            }
        }
    }

    /** 注册默认工具 */
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

    /** 注册自定义工具 */
    registerTool(tool: import('./tools/tool.js').ITool): void {
        this.toolRegistry.register(tool);
    }

    /** 获取工具注册表 */
    getToolRegistry(): ToolRegistry {
        return this.toolRegistry;
    }

    /** 获取当前会话快照（用于持久化/调试，不暴露内部可变实例） */
    getSessionSnapshot(): AgentSessionSnapshot {
        return this.session.toSnapshot();
    }

    /** 清理外部资源 */
    async dispose(): Promise<void> {
        try { await this.lspManager?.dispose(); } catch { /* ignore */ }
        try { await this.mcpManager?.dispose(); } catch { /* ignore */ }
    }

    /** 重置会话 */
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
