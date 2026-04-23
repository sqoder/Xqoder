import type { AgentSession } from './session/session.js';
import type { AgentConfig } from '@xqoder/agent';
import {
    type ApprovalPolicy,
    type ExecutionCapability,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveSmallModelConfig,
    type AgentMode,
    type AgentSettings,
    type AgentPermissionMode,
    type LLMProviderConfig,
    type PermissionSettings,
    type TaskMode,
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
        description: 'Default terminal coding agent that collaborates directly with users to complete tasks.',
        systemPrompt: `You are the default coding agent for XQoder.

Requirements:
- Understand user intent before deciding whether to call tools
- Prioritize actionable and verifiable steps
- Explain results and boundaries after modifying code
- If the user explicitly requests operations outside the project directory (e.g., Desktop), do not refuse, and do not suggest alternatives; directly attempt the target path to trigger permission approval
- When the user expresses "allowing you to operate the entire computer", prioritize triggering permission approval and wait for user selection
- Keep replies concise and prefer English`,
    },
    coder: {
        name: 'coder',
        mode: 'primary',
        description: 'Main implementation agent focused on code modification.',
        systemPrompt: `You are an implementation-oriented coding agent.

Requirements:
- Directly focus on code modification, verification, and finalization
- Prioritize minimal but correct changes
- Point out risks directly without beating around the bush
- If the user explicitly requests operations outside the project directory, directly attempt the target path to trigger permission approval; do not refuse or detour`,
    },
    plan: {
        name: 'plan',
        mode: 'subagent',
        description: 'Responsible for task decomposition and planning.',
        systemPrompt: `You are a task planning agent.

Requirements:
- Break complex tasks into steps with dependency order
- Output should be execution-oriented, not vague analysis
- Prioritize identifying risks, prerequisites, and acceptance methods`,
        defaultUseSmallModel: true,
    },
    explore: {
        name: 'explore',
        mode: 'subagent',
        description: 'Responsible for explaining, retrieving, and understanding the codebase.',
        systemPrompt: `You are a codebase exploration agent.

Requirements:
- Prioritize explaining structure, data flow, call chains, and boundaries
- Do not modify code unnecessarily; focus on understanding and induction
- Output should help the primary agent quickly establish context`,
    },
    summary: {
        name: 'summary',
        mode: 'subagent',
        description: 'Responsible for conversation summarization and context compression.',
        systemPrompt: `You are a conversation summarization agent.

Requirements:
- Preserve paths, function names, decisions, errors, and fix conclusions
- Remove repetitive dialogue and verbose tool outputs
- Output should be compact but must not lose actionable context`,
        defaultUseSmallModel: true,
    },
    title: {
        name: 'title',
        mode: 'subagent',
        description: 'Responsible for generating concise titles for conversations.',
        systemPrompt: `You are a title generation agent.

Requirements:
- Output 50 characters max
- Title should accurately describe the core theme of the conversation
- Do not return extra explanations`,
        defaultUseSmallModel: true,
    },
    compaction: {
        name: 'compaction',
        mode: 'subagent',
        description: 'Responsible for long conversation compression and preparation for continuation.',
        systemPrompt: `You are a context compression agent.

Requirements:
- Distill facts still needed when approaching context limits
- Preserve important constraints, decisions, unresolved items, and file paths
- Output must be suitable for the next round agent to continue working directly`,
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
        runtimeProfile?: AgentConfig['runtimeProfile'];
        permissionsOverride?: PermissionSettings;
        taskMode?: TaskMode;
        executionCapability?: ExecutionCapability;
        approvalPolicy?: ApprovalPolicy;
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
        agentName: runtime.name,
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
        permissions: options.permissionsOverride ?? config.permissions,
        disableAllHooks: config.disableAllHooks,
        hooks: config.hooks,
        compaction: config.compaction,
        runtimeProfile: options.runtimeProfile,
        contextPaths: config.contextPaths,
        ...(options.taskMode ? { taskMode: options.taskMode } : {}),
        ...(options.executionCapability ? { executionCapability: options.executionCapability } : {}),
        ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
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
