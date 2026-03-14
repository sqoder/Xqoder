/**
 * Chat 业务逻辑层（Day 33 第一版）
 * 负责：加载配置、解析 session、构建 agent、执行对话、保存 session、输出格式。
 * command 层仅做参数解析与调用本 service。
 */
import * as path from 'node:path';
import {
    ConfigManager,
    type LSPServerConfig,
    type MCPServerConfig,
    configManager,
    getXQoderPaths,
    logger,
    resolveConfigWithEnvOverrides,
    formatOutput,
    createSpinner,
    type LLMProviderConfig,
    type SandboxSettings,
    type OutputFormat,
    type ShellConfig,
} from '@xqoder/shared';
import {
    AgentSession,
    SQLiteSessionStore,
    type AgentSessionStore,
} from '@xqoder/storage-sqlite';
import type { MessageAttachment } from '@xqoder/shared';
import {
    XQoderAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentCallbacks,
} from '@xqoder/agent';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../agent-ux.js';

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
    sessionStore?: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'saveSession'>;
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
        run(prompt: string, callbacks?: AgentCallbacks): Promise<string>;
        getSession(): AgentSession;
        dispose?: () => Promise<void> | void;
    };
}

export interface NonInteractivePromptOptions {
    prompt: string;
    cwd: string;
    outputFormat: OutputFormat;
    quiet: boolean;
    model?: string;
    agent?: string;
}

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

function createDefaultSessionStore(): AgentSessionStore | undefined {
    try {
        return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
    } catch (err) {
        logger.warn(`Session 持久化不可用，将退回到内存会话: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    }
}

function resolveChatSession(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession'> | undefined,
    options: {
        projectRoot: string;
        sessionId?: string;
        newSession: boolean;
    },
): AgentSession | undefined {
    if (!sessionStore || options.newSession) {
        return undefined;
    }
    if (options.sessionId) {
        const explicitSession = sessionStore.getSession(options.sessionId);
        if (!explicitSession) {
            throw new Error(`未找到指定 session: ${options.sessionId}`);
        }
        return explicitSession;
    }
    return sessionStore.findLatestSession(options.projectRoot) ?? undefined;
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
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    if (!sessionStore) {
        throw new Error('Session 存储不可用');
    }

    const session = resolveChatSession(sessionStore, {
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

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    let fullResponse = '';
    try {
        await agent.run(prompt, {
            onToken: (token: string) => { fullResponse += token; },
        }, options.attachments ?? []);
        const summary = sessionStore.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });
        return { response: fullResponse, sessionId: summary.id };
    } finally {
        await agent.dispose?.();
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
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const session = resolveChatSession(sessionStore, {
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

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const outputFormat: OutputFormat = options.format ?? 'text';
    const isJson = outputFormat === 'json';

    const spinner = isJson ? createSpinner('Thinking...') : null;
    try {
        let fullResponse = '';
        const callbacks = isJson
            ? { ...callbacksFactory(), onToken: (token: string) => { fullResponse += token; } }
            : callbacksFactory();

        await agent.run(prompt, callbacks, options.attachments ?? []);
        sessionStore?.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });

        spinner?.stop();
        if (isJson) {
            process.stdout.write(formatOutput(fullResponse, { format: 'json' }));
        }
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        await agent.dispose?.();
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
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
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

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
        sessionTitle: agentConfig.sessionTitle,
        autoApproveTools: agentConfig.autoApproveTools,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const spinner = !options.quiet && options.outputFormat === 'text'
        ? createSpinner('Thinking...')
        : null;

    try {
        let fullResponse = '';
        await agent.run(options.prompt, {
            onToken: (token: string) => {
                fullResponse += token;
            },
        });

        sessionStore?.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });

        spinner?.stop();
        process.stdout.write(formatOutput(fullResponse, { format: options.outputFormat }));
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        await agent.dispose?.();
    }
}

function buildNonInteractiveTitle(prompt: string): string {
    const trimmedPrompt = prompt.trim();
    const titleSuffix = trimmedPrompt.length > 100
        ? `${trimmedPrompt.slice(0, 100)}...`
        : trimmedPrompt;

    return `Non-interactive: ${titleSuffix}`;
}
