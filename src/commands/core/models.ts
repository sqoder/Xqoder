import * as path from 'node:path';
import { Command } from 'commander';
import { getBuiltInAgentDefinition } from '@xqoder/agent';
import {
    ConfigManager,
    configManager,
    getKnownModelsForProvider,
    isLLMProviderName,
    logger,
    normalizeXQoderConfig,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    SUPPORTED_LLM_PROVIDERS,
    type LLMProviderName,
    type XQoderConfig,
} from '@xqoder/shared';

interface ModelsListOptions {
    json?: boolean;
    provider?: string;
    dir?: string;
    all?: boolean;
    /** OpenCode --refresh: Refresh from models.dev (not yet implemented) */
    refresh?: boolean;
    /** OpenCode --verbose: Show more metadata */
    verbose?: boolean;
}

interface ModelsUseOptions {
    provider?: string;
    agent?: string;
    small?: boolean;
}

interface ModelsCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface ModelCatalogEntry {
    provider: LLMProviderName;
    model: string;
    current: boolean;
    small: boolean;
    flags: string[];
}

export function runListModelsCommand(
    options: ModelsListOptions,
    dependencies: ModelsCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): ModelCatalogEntry[] {
    const providerFilter = options.provider ? parseProviderOrThrow(options.provider) : undefined;
    const config = manager.load({
        cwd: path.resolve(options.dir ?? '.'),
    });
    const entries = buildModelCatalog(config, {
        provider: providerFilter,
        includeAllProviders: options.all ?? false,
    });

    if (options.json) {
        writeOutput(JSON.stringify(entries, null, 2), dependencies);
    } else if (entries.length === 0) {
        writeOutput('No models available.', dependencies);
    } else {
        for (const entry of entries) {
            writeOutput([
                entry.provider,
                entry.model,
                `current=${entry.current ? 'yes' : 'no'}`,
                `small=${entry.small ? 'yes' : 'no'}`,
                `flags=${entry.flags.join(',')}`,
            ].join(' '), dependencies);
        }
    }

    return entries;
}

export function runUseModelCommand(
    model: string,
    options: ModelsUseOptions,
    manager: Pick<ConfigManager, 'load' | 'save' | 'set'> = configManager,
): void {
    const current = manager.load({ mode: 'single' });
    const trimmedModel = model.trim();
    if (!trimmedModel) {
        throw new Error('Model name cannot be empty');
    }

    if (options.small) {
        const provider = options.provider
            ? parseProviderOrThrow(options.provider)
            : current.smallModel?.provider ?? resolveAgentLLMConfig(current).provider;
        const nextConfig = normalizeXQoderConfig({
            ...current,
            providers: {
                ...(current.providers ?? {}),
                [provider]: {
                    ...(current.providers?.[provider] ?? {}),
                    defaultModel: trimmedModel,
                    disabled: false,
                },
            },
            smallModel: {
                provider,
                model: trimmedModel,
            },
        });
        manager.set(nextConfig);
        manager.save();
        logger.success(`Small model switched to ${provider}/${trimmedModel}`);
        return;
    }

    const agentName = options.agent?.trim() || resolveDefaultAgentName(current);
    const resolvedAgentModel = resolveAgentLLMConfig(current, agentName);
    const provider = options.provider
        ? parseProviderOrThrow(options.provider)
        : current.agents?.[agentName]?.provider ?? resolvedAgentModel.provider;
    const existingAgent = current.agents?.[agentName] ?? {};
    const builtInAgent = getBuiltInAgentDefinition(agentName);

    const nextConfig = normalizeXQoderConfig({
        ...current,
        providers: {
            ...(current.providers ?? {}),
            [provider]: {
                ...(current.providers?.[provider] ?? {}),
                defaultModel: trimmedModel,
                disabled: false,
            },
        },
        agents: {
            ...(current.agents ?? {}),
            [agentName]: {
                ...existingAgent,
                mode: existingAgent.mode ?? builtInAgent?.mode ?? 'primary',
                provider,
                model: trimmedModel,
            },
        },
    });

    manager.set(nextConfig);
    manager.save();
    logger.success(`Agent ${agentName} switched to ${provider}/${trimmedModel}`);
}

export function createModelsCommand(
    manager: ConfigManager = configManager,
    dependencies: ModelsCommandDependencies = {},
): Command {
    const modelsCommand = new Command('models')
        .description('Browse and switch models');

    modelsCommand
        .command('list')
        .description('List currently available and remembered models')
        .option('--json', 'Output in JSON format')
        .option('--provider <provider>', 'Filter by provider')
        .option('--dir <dir>', 'Resolve configuration based on directory')
        .option('--all', 'Show default models for all built-in providers')
        .option('--refresh', 'Refresh model list from remote (not yet implemented)')
        .option('--verbose', 'Show more metadata (e.g., cost, etc.)')
        .action((options: ModelsListOptions) => {
            try {
                runListModelsCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`models list failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    modelsCommand
        .command('use')
        .description('Switch model for default agent or small model')
        .argument('<model>', 'model name')
        .option('--provider <provider>', 'Specify provider; inferred from configuration if omitted')
        .option('--agent <name>', 'Only switch model for a specific agent')
        .option('--small', 'Switch small model')
        .action((model: string, options: ModelsUseOptions) => {
            try {
                runUseModelCommand(model, options, manager);
            } catch (error) {
                logger.error(`models use failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    return modelsCommand;
}

export const modelsCommand = createModelsCommand();

function buildModelCatalog(
    config: XQoderConfig,
    options: {
        provider?: LLMProviderName;
        includeAllProviders: boolean;
    },
): ModelCatalogEntry[] {
    const targetProviders = options.provider
        ? [options.provider]
        : (options.includeAllProviders
            ? [...SUPPORTED_LLM_PROVIDERS]
            : collectObservedProviders(config));
    const entryMap = new Map<string, {
        provider: LLMProviderName;
        model: string;
        current: boolean;
        small: boolean;
        flags: Set<string>;
    }>();
    const defaultAgent = resolveDefaultAgentName(config);
    const agentNames = Array.from(new Set([
        defaultAgent,
        ...Object.keys(config.agents ?? {}),
    ]));

    for (const provider of targetProviders) {
        for (const knownModel of getKnownModelsForProvider(provider)) {
            pushModelEntry(entryMap, {
                provider,
                model: knownModel,
                flag: 'builtin-default',
            });
        }

        const providerDefaultModel = config.providers?.[provider]?.defaultModel?.trim();
        if (providerDefaultModel) {
            pushModelEntry(entryMap, {
                provider,
                model: providerDefaultModel,
                flag: 'provider-default',
            });
        }
    }

    for (const agentName of agentNames) {
        const resolved = resolveAgentLLMConfig(config, agentName);
        if (!targetProviders.includes(resolved.provider)) {
            continue;
        }
        pushModelEntry(entryMap, {
            provider: resolved.provider,
            model: resolved.model,
            flag: `agent:${agentName}`,
            current: agentName === defaultAgent,
        });
    }

    if (config.smallModel?.model?.trim()) {
        const provider = config.smallModel.provider ?? resolveAgentLLMConfig(config).provider;
        if (targetProviders.includes(provider)) {
            pushModelEntry(entryMap, {
                provider,
                model: config.smallModel.model.trim(),
                flag: 'small-model',
                small: true,
            });
        }
    }

    return Array.from(entryMap.values())
        .map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            current: entry.current,
            small: entry.small,
            flags: Array.from(entry.flags).sort(),
        }))
        .sort((left, right) => {
            if (left.current !== right.current) {
                return left.current ? -1 : 1;
            }
            if (left.small !== right.small) {
                return left.small ? -1 : 1;
            }
            if (left.provider !== right.provider) {
                return left.provider.localeCompare(right.provider);
            }
            return left.model.localeCompare(right.model);
        });
}

function collectObservedProviders(config: XQoderConfig): LLMProviderName[] {
    const providers = new Set<LLMProviderName>([
        resolveAgentLLMConfig(config).provider,
        ...(Object.keys(config.providers ?? {}) as LLMProviderName[]),
    ]);

    for (const agentName of Object.keys(config.agents ?? {})) {
        providers.add(resolveAgentLLMConfig(config, agentName).provider);
    }

    if (config.smallModel?.provider) {
        providers.add(config.smallModel.provider);
    }

    return Array.from(providers).sort((left, right) => left.localeCompare(right));
}

function pushModelEntry(
    entryMap: Map<string, {
        provider: LLMProviderName;
        model: string;
        current: boolean;
        small: boolean;
        flags: Set<string>;
    }>,
    input: {
        provider: LLMProviderName;
        model: string;
        flag: string;
        current?: boolean;
        small?: boolean;
    },
): void {
    const trimmedModel = input.model.trim();
    if (!trimmedModel) {
        return;
    }

    const key = `${input.provider}:${trimmedModel}`;
    const existing = entryMap.get(key);

    if (existing) {
        existing.flags.add(input.flag);
        existing.current = existing.current || input.current === true;
        existing.small = existing.small || input.small === true;
        return;
    }

    entryMap.set(key, {
        provider: input.provider,
        model: trimmedModel,
        current: input.current === true,
        small: input.small === true,
        flags: new Set([input.flag]),
    });
}

function parseProviderOrThrow(value: string): LLMProviderName {
    if (!isLLMProviderName(value)) {
        throw new Error(`Unsupported provider: ${value}`);
    }

    return value;
}

function writeOutput(output: string, dependencies: ModelsCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
