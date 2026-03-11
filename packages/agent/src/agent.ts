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
} from '@xqoder/shared';
import { AgentError, logger as defaultLogger, Logger, calculateCost, getContextWindow } from '@xqoder/shared';
import { getXQoderPaths } from '@xqoder/shared';
import * as path from 'node:path';
import type { ILLMProvider } from './llm/provider.js';
import type { CompletionRequest } from './llm/provider.js';
import { OpenAIProvider } from '@xqoder/provider-openai';
import { AnthropicProvider } from '@xqoder/provider-anthropic';
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
import { ExternalLanguageServerManager } from './lsp.js';
import { McpServerManager } from './mcp.js';
import { ToolRegistry, type ToolApprovalRequest, type ToolContext } from './tools/tool.js';
import { ListFilesTool, GlobFilesTool, GrepContentTool } from './tools/discovery-tools.js';
import { ReadFileTool, WriteFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
import { SourcegraphTool } from './tools/sourcegraph-tool.js';
import { RunCommandTool, InstallPackageTool } from './tools/command-tool.js';
import { createDefaultLspTools } from './tools/lsp-tools.js';
import { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
import { FetchUrlTool } from './tools/fetch-tool.js';
import { DiagnosticsTool } from './tools/diagnostics-tool.js';
import { DelegateTaskTool } from './tools/agent-tool.js';
import { FileRollbackStore, type RollbackStore } from './tools/rollback-store.js';
import { AgentSession } from './session/session.js';

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
}

/** Agent 运行回调 */
export interface AgentCallbacks extends StreamCallbacks {
    /** 工具执行开始 */
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    /** 工具执行完成 */
    onToolEnd?: (name: string, result: string, success: boolean) => void;
    /** 工具执行过程中的流式输出 */
    onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
    /** 工具执行前审批 */
    onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean> | boolean;
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
    private activeAbort?: AbortController;

    constructor(config: AgentConfig) {
        this.llmConfig = config.llmConfig;
        this.provider = createLLMProvider(config.llmConfig);

        // 初始化工具注册表
        this.toolRegistry = new ToolRegistry();

        // 初始化会话
        this.session = config.session ?? new AgentSession({
            systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            title: config.sessionTitle,
        });
        if (!config.session && config.sessionTitle) {
            this.session.setTitle(config.sessionTitle);
        }

        this.maxIterations = config.maxIterations ?? 20;
        this.autoApproveTools = config.autoApproveTools ?? false;
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
            if (ctxWindow && response.usage.promptTokens >= ctxWindow * 0.85) {
                this.logger.warn(`Context usage at ${Math.round(response.usage.promptTokens / ctxWindow * 100)}%, triggering auto-compact`);
                try {
                    const messages = this.session.getMessages().filter(m => m.role !== 'system');
                    const summaryAgent = new (await import('./sub-agents.js')).SummarizerAgent(this.llmConfig);
                    const summary = await summaryAgent.summarize(messages);
                    this.session.performCompaction(summary);
                    try { callbacks?.onToolEnd?.('auto_compact', summary, true); } catch { /* ignore */ }
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
        for (const tc of toolCalls) {
            let args: Record<string, unknown>;
            try {
                args = (tc.arguments ? JSON.parse(tc.arguments) : {}) as Record<string, unknown>;
            } catch {
                args = {};
                this.logger.warn(`工具 ${tc.name} 参数解析失败: ${tc.arguments?.slice(0, 100)}`);
            }
            this.logger.info(`调用工具: ${tc.name}`);
            try { callbacks?.onToolStart?.(tc.name, args); } catch { /* UI callback must not crash agent */ }
            const startedAt = new Date();

            const result = await this.toolRegistry.execute(
                tc.name,
                args,
                {
                    ...this.toolContext,
                    sessionId: this.session.id,
                    requestToolApproval: callbacks?.onToolApproval
                        ? (request) => Promise.resolve(callbacks.onToolApproval?.(request) ?? false)
                        : this.autoApproveTools
                            ? async () => true
                        : undefined,
                    onToolStream: callbacks?.onToolStream
                        ? (event) => callbacks.onToolStream?.(tc.name, event.chunk, event.stream)
                        : undefined,
                },
                tc.id,
            );
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

            // 将工具结果添加到会话
            const resultContent = result.success
                ? result.output
                : `错误: ${result.error}`;
            this.session.addToolResult(tc.id, resultContent);
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

    /** 获取当前会话 */
    getSession(): AgentSession {
        return this.session;
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
