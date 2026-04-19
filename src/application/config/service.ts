import * as path from 'node:path';
import {
    ConfigManager,
    DeployTarget,
    normalizeXQoderConfig,
    logger,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    type SandboxMode,
    type XQoderConfig,
} from '@xqoder/shared';
import type { LLMProviderConfig } from '@xqoder/shared';
import type { CommandPluginDiscoveryResult } from '../../plugins/command-plugins.js';
import {
    createConfigDoctorReport,
    createConfigShowSnapshot,
} from './doctor.js';
export {
    createConfigDoctorReport,
    createConfigShowSnapshot,
} from './doctor.js';
export type {
    ConfigDoctorCheck,
    ConfigDoctorReport,
    ConfigShowSnapshot,
} from './doctor.js';

export interface ConfigInitOptions {
    provider: LLMProviderConfig['provider'];
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    defaultAgent?: string;
    smallModel?: string;
    smallProvider?: LLMProviderConfig['provider'];
    instruction?: string[];
    defaultDeployTarget?: DeployTarget;
    vercelScope?: string;
    sandboxMode?: SandboxMode;
    allowPath?: string[];
    debug?: boolean;
}

export interface ConfigOutputOptions {
    json?: boolean;
}

export interface ConfigServiceDependencies {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    hasExecutable?: (command: string) => boolean;
    writeOutput?: (output: string) => void;
    discoverPlugins?: (options: {
        cwd?: string;
        pluginConfig?: XQoderConfig['plugins'];
        productVersion: string;
        productName?: string;
    }) => Promise<CommandPluginDiscoveryResult>;
}

export function applyConfigInit(
    currentConfig: XQoderConfig,
    options: ConfigInitOptions,
): XQoderConfig {
    const defaultAgent = options.defaultAgent?.trim() || resolveDefaultAgentName(currentConfig);
    const currentProvider = resolveAgentLLMConfig(currentConfig).provider;
    const providerChanged = options.provider !== currentProvider;
    const allowPaths = options.allowPath ?? [];
    const nextProviders = {
        ...(currentConfig.providers ?? {}),
        [options.provider]: {
            ...(currentConfig.providers?.[options.provider] ?? {}),
            ...(options.model ? { defaultModel: options.model } : {}),
            ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
            ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
            disabled: false,
        },
    };
    const nextAgents = {
        ...(currentConfig.agents ?? {}),
        [defaultAgent]: {
            ...(currentConfig.agents?.[defaultAgent] ?? {}),
            mode: currentConfig.agents?.[defaultAgent]?.mode ?? 'primary',
            provider: options.provider,
            model: options.model ?? (providerChanged ? undefined : currentConfig.agents?.[defaultAgent]?.model),
        },
    };

    return normalizeXQoderConfig({
        ...currentConfig,
        providers: nextProviders,
        defaultAgent,
        smallModel: options.smallModel
            ? {
                provider: options.smallProvider ?? options.provider,
                model: options.smallModel,
            }
            : currentConfig.smallModel,
        agents: nextAgents,
        instructions: (options.instruction?.length ?? 0) > 0
            ? options.instruction
            : currentConfig.instructions,
        defaultDeployTarget: options.defaultDeployTarget ?? currentConfig.defaultDeployTarget,
        vercel: {
            ...(currentConfig.vercel ?? {}),
            ...(options.vercelScope ? { scope: options.vercelScope } : {}),
        },
        sandbox: {
            mode: options.sandboxMode ?? currentConfig.sandbox?.mode ?? 'project',
            allowedPaths: allowPaths.length > 0
                ? allowPaths.map((entry) => path.resolve(entry))
                : (currentConfig.sandbox?.allowedPaths ?? []),
        },
        debug: options.debug ?? currentConfig.debug,
    });
}

export function runConfigInit(
    manager: ConfigManager,
    options: ConfigInitOptions,
    _deps: ConfigServiceDependencies = {},
): void {
    const currentConfig = manager.load({ mode: 'single' });
    const nextConfig = applyConfigInit(currentConfig, options);
    manager.update(nextConfig);
    manager.save();

    logger.success('XQoder config initialized');
    logger.info(`Provider: ${resolveAgentLLMConfig(nextConfig).provider}`);
    logger.info(`Model: ${resolveAgentLLMConfig(nextConfig).model}`);
    logger.info(`Default agent: ${resolveDefaultAgentName(nextConfig)}`);
    logger.info(`Deploy target: ${nextConfig.defaultDeployTarget ?? 'not set'}`);
    logger.info(`Vercel scope: ${nextConfig.vercel?.scope ?? 'not set'}`);
    logger.info(`Sandbox: ${nextConfig.sandbox?.mode ?? 'project'}`);
}

export function runConfigShow(
    manager: ConfigManager,
    options: ConfigOutputOptions,
    deps: ConfigServiceDependencies = {},
): void {
    const env = deps.env ?? process.env;
    const cwd = deps.cwd ?? process.cwd();
    const writeOutput = deps.writeOutput ?? ((s: string) => console.log(s));

    const snapshot = createConfigShowSnapshot(manager, env, cwd);
    const output = JSON.stringify(snapshot, null, 2);

    if (options.json) {
        writeOutput(output);
        return;
    }

    logger.info(`Config path: ${snapshot.configPath}`);
    if (snapshot.appliedEnvVars.length > 0) {
        logger.info(`Applied env overrides: ${snapshot.appliedEnvVars.join(', ')}`);
    }
    if (snapshot.sources.length > 0) {
        logger.info(`Loaded sources: ${snapshot.sources.map((source) => `${source.kind}:${source.path}`).join(', ')}`);
    }
    writeOutput(output);
}

export async function runConfigDoctor(
    manager: ConfigManager,
    options: ConfigOutputOptions,
    deps: ConfigServiceDependencies = {},
): Promise<void> {
    const report = await createConfigDoctorReport(manager, {
        env: deps.env,
        cwd: deps.cwd,
        hasExecutable: deps.hasExecutable,
        discoverPlugins: deps.discoverPlugins,
    });

    const writeOutput = deps.writeOutput ?? ((s: string) => console.log(s));

    if (options.json) {
        writeOutput(JSON.stringify(report, null, 2));
        return;
    }

    logger.info(`Config path: ${report.configPath}`);
    if (report.appliedEnvVars.length > 0) {
        logger.info(`Applied env overrides: ${report.appliedEnvVars.join(', ')}`);
    }
    if (report.sources.length > 0) {
        logger.info(`Loaded sources: ${report.sources.map((source) => `${source.kind}:${source.path}`).join(', ')}`);
    }

    for (const check of report.checks) {
        const line = `${check.name}: ${check.message}`;
        if (check.status === 'ok') {
            logger.success(line);
        } else if (check.status === 'warn') {
            logger.warn(line);
        } else {
            logger.error(line);
        }
    }

    for (const plugin of report.plugins ?? []) {
        const line = `Plugin ${plugin.name}: ${plugin.status} (${plugin.source}${plugin.reason ? `, ${plugin.reason}` : ''})`;
        if (plugin.status === 'loaded') {
            logger.success(line);
        } else if (plugin.status === 'disabled' || plugin.status === 'incompatible') {
            logger.warn(line);
        } else {
            logger.error(line);
        }
    }

    if (report.ok) {
        logger.success('Config check passed');
    } else {
        logger.error('Config check failed');
    }
}
