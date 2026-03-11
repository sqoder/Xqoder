import { Command } from 'commander';
import {
    ConfigManager,
    type AgentMode,
    type AgentPermissionMode,
    type LLMProviderName,
    configManager,
    logger,
    normalizeXQoderConfig,
    resolveDefaultAgentName,
} from '@xqoder/shared';
import {
    getBuiltInAgentDefinition,
    listBuiltInAgents,
    resolveAgentRuntimeConfig,
} from '@xqoder/agent';

interface AgentCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
}

interface AgentOutputOptions {
    json?: boolean;
}

interface AgentSetOptions {
    mode?: AgentMode;
    provider?: LLMProviderName;
    model?: string;
    prompt?: string;
    instruction?: string[];
    tool?: string[];
    cwd?: string;
    permissionMode?: AgentPermissionMode;
    useSmallModel?: boolean;
    enable?: boolean;
    disable?: boolean;
}

interface AgentSummary {
    name: string;
    source: 'built-in' | 'custom' | 'built-in+custom';
    mode: AgentMode;
    default: boolean;
    disabled: boolean;
    provider: string;
    model: string;
    description?: string;
}

export function createAgentCommand(
    manager: ConfigManager = configManager,
    dependencies: AgentCommandDependencies = {},
): Command {
    const command = new Command('agent')
        .description('查看、配置和切换 XQoder agents');

    command
        .command('list')
        .description('列出当前可用的 agents')
        .option('--json', '以 JSON 输出')
        .action((options: AgentOutputOptions) => {
            runAgentAction(() => runListAgentsCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('查看指定 agent 的配置和生效结果')
        .argument('<name>', 'agent 名称')
        .option('--json', '以 JSON 输出')
        .action((name: string, options: AgentOutputOptions) => {
            runAgentAction(() => runShowAgentCommand(name, options, dependencies, manager));
        });

    command
        .command('use')
        .description('切换默认 agent')
        .argument('<name>', 'agent 名称')
        .action((name: string) => {
            runAgentAction(() => runUseAgentCommand(name, dependencies, manager));
        });

    command
        .command('set')
        .description('创建或更新一个 agent 配置')
        .argument('<name>', 'agent 名称')
        .option('--mode <mode>', 'agent 模式 (primary/subagent)')
        .option('--provider <provider>', '默认 provider')
        .option('--model <model>', '默认模型')
        .option('--prompt <text>', '追加的 system prompt')
        .option('--instruction <text>', '额外 instruction，可重复传入', collectOption, [])
        .option('--tool <name>', '限制可用工具，可重复传入', collectOption, [])
        .option('--cwd <dir>', '默认工作目录')
        .option('--permission-mode <mode>', '权限模式 (allow/ask/deny)')
        .option('--use-small-model', '优先使用 small model')
        .option('--enable', '启用该 agent')
        .option('--disable', '禁用该 agent')
        .action((name: string, options: AgentSetOptions) => {
            runAgentAction(() => runSetAgentCommand(name, options, dependencies, manager));
        });

    command
        .command('enable')
        .description('启用一个 agent')
        .argument('<name>', 'agent 名称')
        .action((name: string) => {
            runAgentAction(() => runEnableAgentCommand(name, dependencies, manager));
        });

    command
        .command('disable')
        .description('禁用一个 agent')
        .argument('<name>', 'agent 名称')
        .action((name: string) => {
            runAgentAction(() => runDisableAgentCommand(name, dependencies, manager));
        });

    command
        .command('remove')
        .description('删除一个自定义 agent 配置')
        .argument('<name>', 'agent 名称')
        .action((name: string) => {
            runAgentAction(() => runRemoveAgentCommand(name, dependencies, manager));
        });

    return command;
}

export function runListAgentsCommand(
    options: AgentOutputOptions = {},
    dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): AgentSummary[] {
    const config = manager.load({ cwd: dependencies.cwd ?? process.cwd() });
    const defaultAgent = resolveDefaultAgentName(config);
    const names = new Set([
        ...listBuiltInAgents().map((agent) => agent.name),
        ...Object.keys(config.agents ?? {}),
    ]);
    const agents = Array.from(names)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => {
            const builtIn = getBuiltInAgentDefinition(name);
            const configured = config.agents?.[name];
            const runtime = resolveAgentRuntimeConfig(config, name);

            return {
                name,
                source: builtIn
                    ? (configured ? 'built-in+custom' : 'built-in')
                    : 'custom',
                mode: runtime.mode,
                default: defaultAgent === name,
                disabled: configured?.disabled === true,
                provider: runtime.llmConfig.provider,
                model: runtime.llmConfig.model,
                description: builtIn?.description,
            } satisfies AgentSummary;
        });

    if (options.json) {
        (dependencies.writeOutput ?? console.log)(JSON.stringify(agents, null, 2));
    } else {
        for (const agent of agents) {
            const flags = [
                agent.default ? 'default' : undefined,
                agent.disabled ? 'disabled' : undefined,
                agent.source,
                agent.mode,
            ].filter(Boolean).join(', ');
            (dependencies.writeOutput ?? console.log)(
                `${agent.name} [${flags}] ${agent.provider}/${agent.model}${agent.description ? ` — ${agent.description}` : ''}`,
            );
        }
    }

    return agents;
}

export function runShowAgentCommand(
    name: string,
    options: AgentOutputOptions = {},
    dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Record<string, unknown> {
    const config = manager.load({ cwd: dependencies.cwd ?? process.cwd() });
    const builtIn = getBuiltInAgentDefinition(name);
    const configured = config.agents?.[name];

    if (!builtIn && !configured) {
        throw new Error(`未找到 agent: ${name}`);
    }

    const payload = {
        name,
        default: resolveDefaultAgentName(config) === name,
        source: builtIn
            ? (configured ? 'built-in+custom' : 'built-in')
            : 'custom',
        builtIn,
        configured: configured ?? null,
        runtime: resolveAgentRuntimeConfig(config, name),
    };

    if (options.json) {
        (dependencies.writeOutput ?? console.log)(JSON.stringify(payload, null, 2));
    } else {
        (dependencies.writeOutput ?? console.log)(JSON.stringify(payload, null, 2));
    }

    return payload;
}

export function runUseAgentCommand(
    name: string,
    _dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const currentConfig = manager.load({ mode: 'single' });
    const builtIn = getBuiltInAgentDefinition(name);
    const configured = currentConfig.agents?.[name];

    if (!builtIn && !configured) {
        throw new Error(`未找到 agent: ${name}`);
    }

    manager.update({
        defaultAgent: name,
    });
    manager.save();

    logger.success(`默认 agent 已切换为 ${name}`);
}

export function runSetAgentCommand(
    name: string,
    options: AgentSetOptions,
    _dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const currentConfig = manager.load({ mode: 'single' });
    const builtIn = getBuiltInAgentDefinition(name);
    const existing = currentConfig.agents?.[name] ?? {};
    const mode = options.mode ?? existing.mode ?? builtIn?.mode ?? 'subagent';
    const disabled = options.disable
        ? true
        : options.enable
            ? false
            : existing.disabled;

    manager.update(normalizeXQoderConfig({
        ...currentConfig,
        agents: {
            ...(currentConfig.agents ?? {}),
            [name]: {
                ...existing,
                mode,
                provider: options.provider ?? existing.provider,
                model: options.model ?? existing.model,
                prompt: options.prompt ?? existing.prompt,
                instructions: (options.instruction?.length ?? 0) > 0
                    ? options.instruction
                    : existing.instructions,
                tools: (options.tool?.length ?? 0) > 0
                    ? options.tool
                    : existing.tools,
                cwd: options.cwd ?? existing.cwd,
                permissionMode: options.permissionMode ?? existing.permissionMode,
                useSmallModel: options.useSmallModel === true
                    ? true
                    : existing.useSmallModel,
                disabled,
            },
        },
    }));
    manager.save();

    logger.success(`agent 已保存: ${name}`);
}

export function runEnableAgentCommand(
    name: string,
    dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    runSetAgentCommand(name, { enable: true }, dependencies, manager);
}

export function runDisableAgentCommand(
    name: string,
    dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    runSetAgentCommand(name, { disable: true }, dependencies, manager);
}

export function runRemoveAgentCommand(
    name: string,
    _dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'set' | 'save'> = configManager,
): void {
    const currentConfig = manager.load({ mode: 'single' });
    if (!currentConfig.agents?.[name]) {
        throw new Error(`未找到自定义 agent 配置: ${name}`);
    }

    const nextAgents = {
        ...(currentConfig.agents ?? {}),
    };
    delete nextAgents[name];

    manager.set(normalizeXQoderConfig({
        ...currentConfig,
        defaultAgent: currentConfig.defaultAgent === name && !getBuiltInAgentDefinition(name)
            ? 'general'
            : currentConfig.defaultAgent,
        agents: nextAgents,
    }));
    manager.save();

    logger.success(`已删除 agent 配置: ${name}`);
}

export const agentCommand = createAgentCommand();

function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function runAgentAction(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`agent 命令失败: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
