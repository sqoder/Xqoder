import type { AgentSession } from './session/session.js';
import type { AgentConfig } from './agent.js';
import {
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveSmallModelConfig,
    type AgentMode,
    type AgentSettings,
    type AgentPermissionMode,
    type LLMProviderConfig,
    type XQoderConfig,
} from '@xqoder/shared';

export interface BuiltInAgentDefinition {
    name: string;
    mode: AgentMode;
    description: string;
    systemPrompt: string;
    defaultUseSmallModel?: boolean;
}

export interface ResolvedAgentRuntimeConfig {
    name: string;
    mode: AgentMode;
    llmConfig: LLMProviderConfig;
    systemPrompt: string;
    instructions: string[];
    tools?: string[];
    cwd?: string;
    permissionMode?: AgentPermissionMode;
}

const BUILT_IN_AGENTS: Record<string, BuiltInAgentDefinition> = {
    general: {
        name: 'general',
        mode: 'primary',
        description: '默认的终端 coding agent，会直接与用户协作完成任务。',
        systemPrompt: `你是 XQoder 的默认 coding agent。

要求：
- 先理解用户意图，再决定是否调用工具
- 优先给出可执行、可验证的动作
- 修改代码后要说明结果和边界
- 当用户明确要求操作项目目录外路径（如桌面）时，不要拒绝，不要给“项目内替代方案”，应直接尝试目标路径并触发权限审批
- 当用户表达“允许你操作整台电脑”时，优先触发权限审批并等待用户选择
- 回复保持简洁，优先中文`,
    },
    coder: {
        name: 'coder',
        mode: 'primary',
        description: '偏实现和修改代码的主力 agent。',
        systemPrompt: `你是一个实现导向的 coding agent。

要求：
- 直接聚焦代码修改、验证和结果收口
- 优先做最小但正确的改动
- 发现风险时直接指出，不绕弯
- 当用户明确要求项目外路径操作时，直接尝试目标路径并触发权限审批，不要拒绝或绕路`,
    },
    plan: {
        name: 'plan',
        mode: 'subagent',
        description: '负责任务拆解和计划。',
        systemPrompt: `你是一个任务规划 agent。

要求：
- 把复杂任务拆成有依赖顺序的步骤
- 输出要面向执行，而不是空泛分析
- 优先识别风险、前置条件和验收方式`,
        defaultUseSmallModel: true,
    },
    explore: {
        name: 'explore',
        mode: 'subagent',
        description: '负责解释、检索、理解代码库。',
        systemPrompt: `你是一个代码库探索 agent。

要求：
- 优先解释结构、数据流、调用链和边界
- 不随意修改代码，重点是理解和归纳
- 输出要帮助主 agent 快速建立上下文`,
    },
    summary: {
        name: 'summary',
        mode: 'subagent',
        description: '负责会话摘要和上下文压缩。',
        systemPrompt: `你是一个会话摘要 agent。

要求：
- 保留路径、函数名、决策、错误和修复结论
- 删除重复对话和冗长工具输出
- 输出紧凑但不能丢可执行上下文`,
        defaultUseSmallModel: true,
    },
    title: {
        name: 'title',
        mode: 'subagent',
        description: '负责为会话生成简洁标题。',
        systemPrompt: `你是一个标题生成 agent。

要求：
- 输出短标题
- 标题要准确描述会话核心主题
- 不要返回多余解释`,
        defaultUseSmallModel: true,
    },
    compaction: {
        name: 'compaction',
        mode: 'subagent',
        description: '负责长会话压缩和续接准备。',
        systemPrompt: `你是一个上下文压缩 agent。

要求：
- 在接近上下文上限时提炼后续仍然需要的事实
- 保留重要约束、决定、未完成事项和文件路径
- 输出必须适合下一轮 agent 直接继续工作`,
        defaultUseSmallModel: true,
    },
};

export function listBuiltInAgents(): BuiltInAgentDefinition[] {
    return Object.values(BUILT_IN_AGENTS);
}

export function getBuiltInAgentDefinition(
    name: string,
): BuiltInAgentDefinition | undefined {
    return BUILT_IN_AGENTS[name];
}

export function resolveAgentRuntimeConfig(
    config: XQoderConfig,
    agentName: string = resolveDefaultAgentName(config),
    options: {
        modelOverride?: string;
        promptOverride?: string;
        promptAppendix?: string;
    } = {},
): ResolvedAgentRuntimeConfig {
    const normalizedName = agentName.trim() || resolveDefaultAgentName(config);
    const builtIn = getBuiltInAgentDefinition(normalizedName);
    const configured = config.agents?.[normalizedName] ?? {};
    const useSmallModel = configured.useSmallModel
        ?? builtIn?.defaultUseSmallModel
        ?? false;
    const llmConfig = useSmallModel
        ? resolveSmallModelConfig(config, configured.provider) ?? resolveAgentLLMConfig(config, normalizedName, {
            model: options.modelOverride,
        })
        : resolveAgentLLMConfig(config, normalizedName, {
            model: options.modelOverride,
        });
    const systemPrompt = buildSystemPrompt({
        builtIn,
        configured,
        globalInstructions: config.instructions ?? [],
        promptOverride: options.promptOverride,
        promptAppendix: options.promptAppendix,
    });

    return {
        name: normalizedName,
        mode: configured.mode ?? builtIn?.mode ?? 'primary',
        llmConfig,
        systemPrompt,
        instructions: [
            ...(config.instructions ?? []),
            ...(configured.instructions ?? []),
        ],
        tools: configured.tools,
        cwd: configured.cwd,
        permissionMode: configured.permissionMode,
    };
}

export function buildAgentConfigFromXQoderConfig(
    config: XQoderConfig,
    options: {
        agentName?: string;
        cwd?: string;
        projectRoot?: string;
        modelOverride?: string;
        promptOverride?: string;
        promptAppendix?: string;
        session?: AgentSession;
        sessionTitle?: string;
        autoApproveTools?: boolean;
    } = {},
): AgentConfig {
    const runtime = resolveAgentRuntimeConfig(
        config,
        options.agentName,
        {
            modelOverride: options.modelOverride,
            promptOverride: options.promptOverride,
            promptAppendix: options.promptAppendix,
        },
    );

    return {
        llmConfig: runtime.llmConfig,
        systemPrompt: runtime.systemPrompt,
        cwd: options.cwd ?? runtime.cwd,
        projectRoot: options.projectRoot,
        sandboxMode: config.sandbox?.mode,
        allowedPaths: config.sandbox?.allowedPaths,
        shell: config.shell,
        mcpServers: config.mcp?.servers,
        lspServers: config.lsp?.servers,
        session: options.session,
        sessionTitle: options.sessionTitle,
        autoApproveTools: options.autoApproveTools,
        permissions: config.permissions,
        compaction: config.compaction,
    };
}

function buildSystemPrompt(options: {
    builtIn?: BuiltInAgentDefinition;
    configured: AgentSettings;
    globalInstructions: string[];
    promptOverride?: string;
    promptAppendix?: string;
}): string {
    const sections = [
        options.builtIn?.systemPrompt,
        options.configured.prompt,
        options.promptOverride,
        formatInstructions('Global Instructions', options.globalInstructions),
        formatInstructions('Agent Instructions', options.configured.instructions ?? []),
        options.promptAppendix,
    ].filter((value): value is string => Boolean(value && value.trim()));

    return sections.join('\n\n');
}

function formatInstructions(title: string, instructions: string[]): string | undefined {
    if (instructions.length === 0) {
        return undefined;
    }

    return [
        `${title}:`,
        ...instructions.map((entry) => `- ${entry}`),
    ].join('\n');
}
