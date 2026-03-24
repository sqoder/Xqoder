/**
 * Chat 业务逻辑层（Day 33 第一版）
 * 负责：加载配置、解析 session、构建 agent、执行对话、保存 session、输出格式。
 * command 层仅做参数解析与调用本 service。
 */
import * as path from 'node:path';
import {
    ConfigManager,
    type PermissionSettings,
    type LSPServerConfig,
    type MCPServerConfig,
    configManager,
    getMessageAttachmentKind,
    logger,
    resolveConfigWithEnvOverrides,
    formatOutput,
    createSpinner,
    type LLMMessage,
    type LLMProviderConfig,
    type SandboxSettings,
    type OutputFormat,
    type ShellConfig,
    resolveToolPermissionMode,
} from '@xqoder/shared';
import type { MessageAttachment } from '@xqoder/shared';
import {
    AgentSession,
    createXQoderAgentProvider,
    buildAgentConfigFromXQoderConfig,
    type AgentConfig,
    type AgentCallbacks,
} from '@xqoder/agent';
import { definePlugin, type RuntimeDescriptor } from '@xqoder/plugin-sdk';
import type { AppEvent, CoreMessage, MessageAttachment as ProtocolMessageAttachment } from '@xqoder/protocol';
import {
    createRuntimeSessionKernel,
    isRuntimeSessionKernelHandle,
    openDefaultRuntimeSessionKernel,
    openInMemoryRuntimeSessionKernel,
    type RuntimeSessionKernelHandle,
    type RuntimeSessionKernelStoreLike,
} from './runtime-session-kernel.js';
import {
    createRuntimeSessionResolveStoreAdapter,
    loadRuntimeSessionSnapshotRecord,
    resolveSessionForReuse,
    type RuntimeSessionResolveStore,
} from './session-resolve.js';

export interface ChatRunOptions {
    dir: string;
    model?: string;
    agent?: string;
    session?: string;
    newSession?: boolean;
    format?: OutputFormat;
    /** 附件（如 run --file 传入），与 OpenCode 行为对齐 */
    attachments?: MessageAttachment[];
}

export interface ChatServiceDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    /**
     * 优先注入 runtime-native handle；这是新的推荐路径。
     */
    sessionKernelHandle?: ChatSessionKernelHandle;
    agentFactory?: (config: {
        llmConfig: LLMProviderConfig;
        cwd: string;
        projectRoot: string;
        systemPrompt: string;
        sandboxMode: SandboxSettings['mode'];
        allowedPaths: string[];
        shell?: ShellConfig;
        mcpServers?: MCPServerConfig[];
        lspServers?: LSPServerConfig[];
        session?: AgentSession;
        sessionTitle?: string;
        autoApproveTools?: boolean;
    }) => {
        run(prompt: string, callbacks?: AgentCallbacks, attachments?: MessageAttachment[]): Promise<string>;
        dispose?: () => Promise<void> | void;
    };
}

type ChatRuntimeStoreLike = RuntimeSessionKernelStoreLike;
type ChatSessionSource = ChatSessionKernelHandle | ChatRuntimeStoreLike;

export interface ChatSessionAccess {
    resolveStore: RuntimeSessionResolveStore;
    runtimeStore: ChatRuntimeStoreLike;
    close(): void;
}

type ChatSessionKernelHandle = RuntimeSessionKernelHandle;

export interface NonInteractivePromptOptions {
    prompt: string;
    cwd: string;
    outputFormat: OutputFormat;
    quiet: boolean;
    model?: string;
    agent?: string;
}

export { resolveRuntimeSessionStore } from './runtime-session-kernel.js';

export function buildChatSystemPrompt(sandbox: SandboxSettings): string {
    const permissionHint = sandbox.mode === 'full-access'
        ? '你当前处于 full-access 模式，可以读写本机任意路径。只有当用户明确要求时，才操作项目目录之外的文件。'
        : sandbox.mode === 'paths'
            ? `你当前可以访问项目目录，以及这些额外路径: ${sandbox.allowedPaths.length > 0 ? sandbox.allowedPaths.join(', ') : '无'}。`
            : '你当前只能访问项目目录。';

    return `你是 XQoder，一个在终端中工作的 AI 编程助手。

工作方式：
- ${permissionHint}
- 对于问候、闲聊、澄清问题，先直接回复，不要主动调用工具
- 对于明确的代码任务，再按需读取文件、搜索代码、执行命令、修改文件
- 如果用户要求生成整个项目、修复、运行、测试、部署，你可以先给出简短判断；当前终端也提供 /build /fix /run /test /deploy 这些稳定工作流命令
- 如果用户明确要求操作项目目录外的路径（如桌面），不要直接拒绝，也不要改成“项目内替代方案”；应直接按目标路径尝试并触发权限审批，让用户选择是否放行
- 如果用户表达“可操作整台电脑/给全部权限”，优先触发审批并等待用户决定
- 回复保持简洁，优先中文

回答格式（非常重要，尽量遵守）：
每次回答编码相关问题时，请使用以下 6 个区块的结构化输出，区块标题使用英文，内容可以用中文：

--------------------------------------------------
USER_PROMPT
简要重述或引用用户的问题，帮助快速回顾上下文。

--------------------------------------------------
PLAN
用编号列出你打算执行的步骤，例如：
1. 定位相关文件和函数
2. 阅读现有实现，确认问题
3. 修改或新增代码
4. 运行相关测试并总结结果

--------------------------------------------------
EXECUTION_LOG
在这里记录你实际执行过的动作（查了什么文件、跑了什么命令），用简短条目，不要粘贴大段代码。

--------------------------------------------------
RESULT
用 1–3 行总结这次操作的关键结果，例如是否修好了问题、发现了什么风险或结论。

--------------------------------------------------
FILE_CHANGES
当你建议具体改动时，按文件给出 Git 风格的 \\\`diff\\\` 代码块（“FILE: 路径” + \`\`\`diff 块）。
如果本次不涉及修改代码，请在这一节明确写出“本次无实际代码改动，仅给出设计/说明。”。

--------------------------------------------------
NEXT_STEPS
给出用户后续可以执行的 1–3 个建议步骤（例如跑测试、检查某个文件、补充信息等）。

在终端宽度受限时，你可以适当精简文字，但仍应保留上述 6 个区块的标题顺序。`;
}

function resolveRuntimeToolPermissionMode(toolName: string, permissions: PermissionSettings | undefined) {
    return resolveToolPermissionMode(toolName, permissions);
}

function readToolNameFromTarget(target: string): string {
    const separator = target.lastIndexOf(':');
    return separator >= 0 ? target.slice(separator + 1) : target;
}

function toProtocolAttachment(attachment: MessageAttachment): ProtocolMessageAttachment {
    const kind = getMessageAttachmentKind(attachment);
    return {
        kind,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        ...(attachment.url ? { url: attachment.url } : {}),
    };
}

function toSharedAttachment(attachment: ProtocolMessageAttachment): MessageAttachment {
    const kind = attachment.kind === 'image' ? 'image' : 'file';
    return {
        kind,
        type: kind,
        mimeType: attachment.mimeType ?? (attachment.kind === 'image' ? 'image/png' : 'application/octet-stream'),
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        ...(attachment.url ? { url: attachment.url } : {}),
    };
}

function toCoreMessage(message: LLMMessage, sessionId: string, index: number): CoreMessage {
    return {
        id: `${sessionId}:history:${index}`,
        sessionId,
        role: message.role,
        content: message.content,
        createdAt: Date.now(),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.thinking ? { thinking: message.thinking } : {}),
        ...(message.toolCalls && message.toolCalls.length > 0
            ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
            : {}),
        ...(message.attachments && message.attachments.length > 0
            ? { attachments: message.attachments.map((attachment) => toProtocolAttachment(attachment as MessageAttachment)) }
            : {}),
        ...(message.parts && message.parts.length > 0
            ? {
                parts: message.parts.map((part) => {
                    if (part.type === 'tool_call') {
                        return {
                            ...part,
                            toolCall: { ...part.toolCall },
                        };
                    }
                    return { ...part };
                }),
            }
            : {}),
    };
}

function readToolCallId(event: Extract<AppEvent, { type: 'tool.output' | 'tool.completed' }>): string | undefined {
    const metadata = (event as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object') {
        return undefined;
    }
    const value = (metadata as Record<string, unknown>)['toolCallId'];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function createRuntimeDescriptor(options: {
    sessionId: string;
    cwd: string;
    permissions: PermissionSettings | undefined;
    callbacks?: AgentCallbacks;
}): RuntimeDescriptor {
    return {
        sessionId: options.sessionId,
        cwd: options.cwd,
        permissionPolicy: {
            evaluate: async (request: { target?: string }) => {
                const target = typeof request.target === 'string' ? request.target : '';
                const toolName = readToolNameFromTarget(target);
                const mode = resolveRuntimeToolPermissionMode(toolName, options.permissions);
                if (mode === 'ask' && !options.callbacks?.onToolApproval) {
                    return 'deny' as const;
                }
                return mode;
            },
        },
        requestToolApproval: options.callbacks?.onToolApproval
            ? async (request) => (await options.callbacks?.onToolApproval?.({
                toolCallId: request.toolCallId,
                toolName: request.toolName,
                summary: request.summary,
                reason: request.reason,
                preview: request.preview,
                risk: request.risk,
            })) ? 'allow' : 'deny'
            : undefined,
        requestQuestion: options.callbacks?.onQuestion
            ? async (request) => (await options.callbacks?.onQuestion?.(request)) ?? {
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }
            : async (request) => ({
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }),
    };
}

async function runChatViaRuntime(options: {
    prompt: string;
    resolvedDir: string;
    agentConfig: AgentConfig;
    runtimeStore: ChatRuntimeStoreLike;
    callbacks?: AgentCallbacks;
    attachments?: MessageAttachment[];
    agentFactory?: ChatServiceDependencies['agentFactory'];
}): Promise<{ response: string; sessionId: string }> {
    const runtime = createRuntimeSessionKernel(options.runtimeStore, {
        projectRoot: options.resolvedDir,
        model: options.agentConfig.llmConfig.model,
    }, options.agentConfig.session ? [options.agentConfig.session] : []);

    let pendingAgentConfig: AgentConfig | null = null;
    await runtime.registerPlugin(definePlugin({
        manifest: {
            name: 'xqoder-chat-runtime-builtins',
            version: '0.1.0',
            capabilities: ['agent-provider'],
        },
        setup(api) {
            api.registerAgentProvider(createXQoderAgentProvider(
                async () => {
                    if (!pendingAgentConfig) {
                        throw new Error('No pending agent configuration');
                    }
                    return pendingAgentConfig;
                },
                {
                    name: 'xqoder-agent',
                    ...(options.agentFactory
                        ? {
                            createAgent: (config) => {
                                const created = options.agentFactory?.({
                                    ...config,
                                    cwd: config.cwd ?? options.resolvedDir,
                                    projectRoot: config.projectRoot ?? options.resolvedDir,
                                    systemPrompt: config.systemPrompt ?? '',
                                    sandboxMode: config.sandboxMode ?? 'project',
                                    allowedPaths: config.allowedPaths ?? [],
                                    shell: config.shell,
                                    mcpServers: config.mcpServers,
                                    lspServers: config.lspServers,
                                    session: config.session,
                                    sessionTitle: config.sessionTitle,
                                    autoApproveTools: config.autoApproveTools,
                                    llmConfig: config.llmConfig,
                                });
                                if (!created) {
                                    throw new Error('agentFactory returned undefined');
                                }
                                return {
                                    run: (prompt, callbacks, attachments) => created.run(prompt, callbacks, attachments),
                                    ...(created.dispose
                                        ? {
                                            dispose: async () => {
                                                await created.dispose?.();
                                            },
                                        }
                                        : {}),
                                };
                            },
                        }
                        : {}),
                },
            ));
        },
    }));

    const session = options.agentConfig.session ?? new AgentSession({
        systemPrompt: options.agentConfig.systemPrompt,
        title: options.agentConfig.sessionTitle,
    });
    pendingAgentConfig = {
        ...options.agentConfig,
        cwd: options.resolvedDir,
        projectRoot: options.resolvedDir,
        session,
    };

    const runtimeDescriptor = createRuntimeDescriptor({
        sessionId: session.id,
        cwd: options.resolvedDir,
        permissions: options.agentConfig.permissions,
        callbacks: options.callbacks,
    });

    let fullResponse = '';
    let sawAssistantDelta = false;
    let completedAssistant = '';
    let runtimeError: Error | null = null;
    const toolOutputs = new Map<string, string>();

    const historyMessages = session.getMessages().map((entry, index) => toCoreMessage(entry, session.id, index));
    const attachments = options.attachments ?? [];
    const task = {
        prompt: options.prompt,
        messages: historyMessages,
        ...(attachments.length > 0 ? { attachments: attachments.map(toProtocolAttachment) } : {}),
    };

    for await (const event of runtime.runAgent('xqoder-agent', task, runtimeDescriptor)) {
        switch (event.type) {
            case 'message.delta':
                if (event.role === 'assistant') {
                    sawAssistantDelta = true;
                    fullResponse += event.text;
                    options.callbacks?.onToken?.(event.text);
                }
                break;
            case 'message.completed':
                if (event.message.role === 'assistant') {
                    completedAssistant = event.message.content;
                    if (!sawAssistantDelta && event.message.content.length > 0) {
                        fullResponse += event.message.content;
                        options.callbacks?.onToken?.(event.message.content);
                    }
                }
                break;
            case 'tool.called':
                options.callbacks?.onToolStart?.(
                    event.tool,
                    typeof event.args === 'object' && event.args !== null && !Array.isArray(event.args)
                        ? event.args as Record<string, unknown>
                        : {},
                );
                break;
            case 'tool.output':
                if (event.partial) {
                    options.callbacks?.onToolStream?.(event.tool, event.output, 'stdout');
                } else {
                    const key = readToolCallId(event) ?? event.tool;
                    toolOutputs.set(key, event.output);
                }
                break;
            case 'tool.completed':
                {
                    const key = readToolCallId(event) ?? event.tool;
                    const result = toolOutputs.get(key) ?? '';
                    options.callbacks?.onToolEnd?.(
                        event.tool,
                        result,
                        event.success,
                        event.metadata && typeof event.metadata === 'object'
                            ? event.metadata as Record<string, unknown>
                            : undefined,
                    );
                }
                break;
            case 'error':
                runtimeError = new Error(event.message);
                options.callbacks?.onError?.(runtimeError);
                break;
            default:
                break;
        }
    }

    if (runtimeError) {
        throw runtimeError;
    }

    const response = fullResponse || completedAssistant;
    const persistedRecord = await loadRuntimeSessionSnapshotRecord(runtime, session.id);
    return {
        response,
        sessionId: persistedRecord?.id ?? session.id,
    };
}

export function openChatSessionAccess(
    sessionSource: ChatSessionSource | undefined,
    defaults: {
        projectRoot: string;
        model: string;
    },
    options: {
        allowMemoryFallback: boolean;
        openSessionKernel?: (defaults: { projectRoot: string; model: string }) => ChatSessionKernelHandle;
    } = {
        allowMemoryFallback: false,
    },
): ChatSessionAccess | undefined {
    if (sessionSource && isRuntimeSessionKernelHandle(sessionSource)) {
        return {
            resolveStore: sessionSource.kernel,
            runtimeStore: sessionSource.store,
            close: () => {
                sessionSource.close();
            },
        };
    }

    if (sessionSource) {
        return {
            resolveStore: createRuntimeSessionResolveStoreAdapter(sessionSource, {
                projectRoot: defaults.projectRoot,
                cwd: defaults.projectRoot,
                model: defaults.model,
            }),
            runtimeStore: sessionSource,
            close: () => {},
        };
    }

    try {
        const kernelHandle = (options.openSessionKernel ?? openDefaultRuntimeSessionKernel)(defaults);
        return {
            resolveStore: kernelHandle.kernel,
            runtimeStore: kernelHandle.store,
            close: () => {
                kernelHandle.close();
            },
        };
    } catch (err) {
        logger.warn(`Session 持久化不可用，将退回到内存会话: ${err instanceof Error ? err.message : String(err)}`);
        if (!options.allowMemoryFallback) {
            return undefined;
        }

        const kernelHandle = openInMemoryRuntimeSessionKernel(defaults);
        return {
            resolveStore: kernelHandle.kernel,
            runtimeStore: kernelHandle.store,
            close: () => {
                kernelHandle.close();
            },
        };
    }
}

async function resolveChatSession(
    resolveStore: RuntimeSessionResolveStore | undefined,
    options: {
        projectRoot: string;
        sessionId?: string;
        newSession: boolean;
    },
): Promise<AgentSession | undefined> {
    return resolveSessionForReuse(resolveStore, options);
}

/** 无头运行单轮对话并返回结果（供 serve API 使用） */
export async function runChatHeadless(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<{ response: string; sessionId: string }> {
    const resolvedDir = path.resolve(options.dir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? { mode: 'project', allowedPaths: [] };
    const sessionAccess = openChatSessionAccess(dependencies.sessionKernelHandle, {
        projectRoot: resolvedDir,
        model: options.model?.trim() || effectiveConfig.llm.model,
    }, {
        allowMemoryFallback: false,
    });
    if (!sessionAccess) {
        throw new Error('Session 存储不可用');
    }
    try {
        const session = await resolveChatSession(sessionAccess.resolveStore, {
            projectRoot: resolvedDir,
            sessionId: options.session,
            newSession: options.newSession ?? false,
        });
        const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
            agentName: options.agent,
            cwd: resolvedDir,
            projectRoot: resolvedDir,
            modelOverride: options.model,
            promptAppendix: buildChatSystemPrompt(sandbox),
            session,
        });

        if (!agentConfig.llmConfig.apiKey.trim()) {
            throw new Error('LLM API Key 未配置');
        }

        let fullResponse = '';
        const result = await runChatViaRuntime({
            prompt,
            resolvedDir,
            agentConfig: {
                ...agentConfig,
                cwd: resolvedDir,
                projectRoot: resolvedDir,
            },
            runtimeStore: sessionAccess.runtimeStore,
            callbacks: {
                onToken: (token) => {
                    fullResponse += token;
                },
            },
            attachments: options.attachments ?? [],
            agentFactory: dependencies.agentFactory,
        });
        return {
            response: fullResponse || result.response,
            sessionId: result.sessionId,
        };
    } finally {
        sessionAccess.close();
    }
}

export async function runChat(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
    callbacksFactory: () => AgentCallbacks,
): Promise<void> {
    const resolvedDir = path.resolve(options.dir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionAccess = openChatSessionAccess(dependencies.sessionKernelHandle, {
        projectRoot: resolvedDir,
        model: options.model?.trim() || effectiveConfig.llm.model,
    }, {
        allowMemoryFallback: true,
    })!;
    try {
        const session = await resolveChatSession(sessionAccess.resolveStore, {
            projectRoot: resolvedDir,
            sessionId: options.session,
            newSession: options.newSession ?? false,
        });
        const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
            agentName: options.agent,
            cwd: resolvedDir,
            projectRoot: resolvedDir,
            modelOverride: options.model,
            promptAppendix: buildChatSystemPrompt(sandbox),
            session,
        });

        if (!dependencies.agentFactory && !agentConfig.llmConfig.apiKey.trim()) {
            throw new Error('LLM API Key 未配置，请先运行 xqoder config init --api-key <key>');
        }

        const outputFormat: OutputFormat = options.format ?? 'text';
        const isJson = outputFormat === 'json';

        const spinner = isJson ? createSpinner('Thinking...') : null;
        try {
            let fullResponse = '';
            const callbacks = isJson
                ? { ...callbacksFactory(), onToken: (token: string) => { fullResponse += token; } }
                : callbacksFactory();

            const result = await runChatViaRuntime({
                prompt,
                resolvedDir,
                agentConfig: {
                    ...agentConfig,
                    cwd: resolvedDir,
                    projectRoot: resolvedDir,
                },
                runtimeStore: sessionAccess.runtimeStore,
                callbacks,
                attachments: options.attachments ?? [],
                agentFactory: dependencies.agentFactory,
            });

            spinner?.stop();
            if (isJson) {
                process.stdout.write(formatOutput(fullResponse || result.response, { format: 'json' }));
            }
            process.stdout.write('\n');
        } finally {
            spinner?.stop();
        }
    } finally {
        sessionAccess.close();
    }
}

export async function runNonInteractivePrompt(
    options: NonInteractivePromptOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<void> {
    const resolvedDir = path.resolve(options.cwd);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionAccess = openChatSessionAccess(dependencies.sessionKernelHandle, {
        projectRoot: resolvedDir,
        model: options.model?.trim() || effectiveConfig.llm.model,
    }, {
        allowMemoryFallback: true,
    })!;
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: buildChatSystemPrompt(sandbox),
        sessionTitle: buildNonInteractiveTitle(options.prompt),
        autoApproveTools: true,
    });

    if (!dependencies.agentFactory && !agentConfig.llmConfig.apiKey.trim()) {
        throw new Error('LLM API Key 未配置，请先运行 xqoder config init --api-key <key>');
    }

    const spinner = !options.quiet && options.outputFormat === 'text'
        ? createSpinner('Thinking...')
        : null;

    try {
        let fullResponse = '';
        const result = await runChatViaRuntime({
            prompt: options.prompt,
            resolvedDir,
            agentConfig: {
                ...agentConfig,
                cwd: resolvedDir,
                projectRoot: resolvedDir,
            },
            runtimeStore: sessionAccess.runtimeStore,
            callbacks: {
                onToken: (token: string) => {
                    fullResponse += token;
                },
            },
            agentFactory: dependencies.agentFactory,
        });

        spinner?.stop();
        process.stdout.write(formatOutput(fullResponse || result.response, { format: options.outputFormat }));
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        sessionAccess.close();
    }
}

function buildNonInteractiveTitle(prompt: string): string {
    const trimmedPrompt = prompt.trim();
    const titleSuffix = trimmedPrompt.length > 100
        ? `${trimmedPrompt.slice(0, 100)}...`
        : trimmedPrompt;

    return `Non-interactive: ${titleSuffix}`;
}
