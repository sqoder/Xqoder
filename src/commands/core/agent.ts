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
    getMarkdownAgentDefinition,
    listBuiltInAgents,
    listMarkdownAgents,
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
    source: string;
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
        .description('View, configure and switch XQoder agents');

    command
        .command('list')
        .description('List currently available agents')
        .option('--json', 'Output in JSON format')
        .action((options: AgentOutputOptions) => {
            runAgentAction(() => runListAgentsCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('View configuration and runtime results for a specific agent')
        .argument('<name>', 'agent name')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: AgentOutputOptions) => {
            runAgentAction(() => runShowAgentCommand(name, options, dependencies, manager));
        });

    command
        .command('use')
        .description('Switch default agent')
        .argument('<name>', 'agent name')
        .action((name: string) => {
            runAgentAction(() => runUseAgentCommand(name, dependencies, manager));
        });

    command
        .command('set')
        .description('Create or update an agent configuration')
        .argument('<name>', 'agent name')
        .option('--mode <mode>', 'agent mode (primary/subagent)')
        .option('--provider <provider>', 'default provider')
        .option('--model <model>', 'default model')
        .option('--prompt <text>', 'appended system prompt')
        .option('--instruction <text>', 'extra instruction, can be passed multiple times', collectOption, [])
        .option('--tool <name>', 'limit available tools, can be passed multiple times', collectOption, [])
        .option('--cwd <dir>', 'default working directory')
        .option('--permission-mode <mode>', 'permission mode (allow/ask/deny)')
        .option('--use-small-model', 'prefer using small model')
        .option('--enable', 'enable this agent')
        .option('--disable', 'disable this agent')
        .action((name: string, options: AgentSetOptions) => {
            runAgentAction(() => runSetAgentCommand(name, options, dependencies, manager));
        });

    command
        .command('enable')
        .description('Enable an agent')
        .argument('<name>', 'agent name')
        .action((name: string) => {
            runAgentAction(() => runEnableAgentCommand(name, dependencies, manager));
        });

    command
        .command('disable')
        .description('Disable an agent')
        .argument('<name>', 'agent name')
        .action((name: string) => {
            runAgentAction(() => runDisableAgentCommand(name, dependencies, manager));
        });

    command
        .command('remove')
        .description('Delete a custom agent configuration')
        .argument('<name>', 'agent name')
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
    const resolvedCwd = dependencies.cwd ?? process.cwd();
    const config = manager.load({ cwd: resolvedCwd });
    const defaultAgent = resolveDefaultAgentName(config);
    const markdownAgents = listMarkdownAgents(resolvedCwd);
    const names = new Set([
        ...listBuiltInAgents().map((agent) => agent.name),
        ...markdownAgents.map((agent) => agent.name),
        ...Object.keys(config.agents ?? {}),
    ]);
    const agents = Array.from(names)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => {
            const builtIn = getBuiltInAgentDefinition(name);
            const markdown = markdownAgents.find((agent) => agent.name === name);
            const configured = config.agents?.[name];
            const runtime = resolveAgentRuntimeConfig(config, name, { cwd: resolvedCwd });

            return {
                name,
                source: describeAgentSource({
                    builtIn: Boolean(builtIn),
                    markdown: Boolean(markdown),
                    configured: Boolean(configured),
                }),
                mode: runtime.mode,
                default: defaultAgent === name,
                disabled: configured?.disabled === true,
                provider: runtime.llmConfig.provider,
                model: runtime.llmConfig.model,
                description: builtIn?.description ?? markdown?.description,
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
    const resolvedCwd = dependencies.cwd ?? process.cwd();
    const config = manager.load({ cwd: resolvedCwd });
    const builtIn = getBuiltInAgentDefinition(name);
    const markdown = getMarkdownAgentDefinition(name, resolvedCwd);
    const configured = config.agents?.[name];

    if (!builtIn && !markdown && !configured) {
        throw new Error(`Agent not found: ${name}`);
    }

    const payload = {
        name,
        default: resolveDefaultAgentName(config) === name,
        source: describeAgentSource({
            builtIn: Boolean(builtIn),
            markdown: Boolean(markdown),
            configured: Boolean(configured),
        }),
        builtIn,
        markdown: markdown ?? null,
        configured: configured ?? null,
        runtime: resolveAgentRuntimeConfig(config, name, { cwd: resolvedCwd }),
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
    dependencies: AgentCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const currentConfig = manager.load({ mode: 'single' });
    const builtIn = getBuiltInAgentDefinition(name);
    const markdown = getMarkdownAgentDefinition(name, dependencies.cwd ?? process.cwd());
    const configured = currentConfig.agents?.[name];

    if (!builtIn && !markdown && !configured) {
        throw new Error(`Agent not found: ${name}`);
    }

    manager.update({
        defaultAgent: name,
    });
    manager.save();

    logger.success(`Default agent switched to ${name}`);
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

    logger.success(`Agent saved: ${name}`);
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
        throw new Error(`Custom agent configuration not found: ${name}`);
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

    logger.success(`Agent configuration deleted: ${name}`);
}

export const agentCommand = createAgentCommand();

function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function describeAgentSource(input: {
    builtIn: boolean;
    markdown: boolean;
    configured: boolean;
}): string {
    const sources = [
        input.builtIn ? 'built-in' : undefined,
        input.markdown ? 'markdown' : undefined,
        input.configured ? 'custom' : undefined,
    ].filter(Boolean);

    return sources.join('+');
}

function runAgentAction(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`Agent command failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
