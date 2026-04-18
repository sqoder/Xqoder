import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    ConfigManager,
    type ConfigSourceInfo,
    DeployTarget,
    normalizeXQoderConfig,
    logger,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveConfigWithEnvOverrides,
    type SandboxMode,
    type LSPServerConfig,
    type LSPTcpServerConfig,
    type XQoderConfig,
} from '@xqoder/shared';
import type { LLMProviderConfig } from '@xqoder/shared';
import { discoverCommandRegistrationsWithReport, type CommandPluginDiscoveryResult } from '../../plugins/command-plugins.js';
import { getXQoderVersion } from '../../cli/version.js';

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

export interface ConfigDoctorCheck {
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
}

export interface ConfigDoctorReport {
    ok: boolean;
    configPath: string;
    appliedEnvVars: string[];
    sources: ConfigSourceInfo[];
    checks: ConfigDoctorCheck[];
    plugins?: CommandPluginDiscoveryResult['report'];
}

export interface ConfigShowSnapshot {
    configPath: string;
    appliedEnvVars: string[];
    sources: ConfigSourceInfo[];
    config: XQoderConfig;
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

function maskSecret(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function maskSecretRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!value) return undefined;
    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, maskSecret(entry)]),
    );
}

export function createConfigShowSnapshot(
    manager: Pick<ConfigManager, 'load' | 'getConfigPath' | 'getLoadMetadata'>,
    env: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
): ConfigShowSnapshot {
    const { config, appliedEnvVars } = resolveConfigWithEnvOverrides(manager.load({ cwd, env }), env);

    return {
        configPath: manager.getConfigPath(),
        appliedEnvVars,
        sources: manager.getLoadMetadata().sources.filter((source) => source.exists),
        config: {
            ...config,
            llm: {
                ...config.llm,
                apiKey: maskSecret(config.llm.apiKey),
            },
            providers: Object.fromEntries(
                Object.entries(config.providers ?? {}).map(([name, provider]) => [
                    name,
                    {
                        ...provider,
                        apiKey: maskSecret(provider?.apiKey ?? ''),
                    },
                ]),
            ),
            mcp: {
                servers: (config.mcp?.servers ?? []).map((server) => ({
                    ...server,
                    env: maskSecretRecord(server.env),
                })),
            },
            lsp: {
                servers: (config.lsp?.servers ?? []).map((server) => ({
                    ...server,
                    env: maskSecretRecord(server.env),
                })),
            },
        },
    };
}

function defaultHasExecutable(command: string): boolean {
    const result = spawnSync('which', [command], {
        encoding: 'utf-8',
        stdio: 'ignore',
    });
    return result.status === 0;
}

function isTcpServerConfig(server: LSPServerConfig): server is LSPTcpServerConfig {
    return server.transport === 'tcp';
}

function commandExists(
    command: string,
    hasExecutable: (command: string) => boolean,
): boolean {
    if (path.isAbsolute(command) || command.startsWith('.')) {
        return fs.existsSync(command);
    }
    return hasExecutable(command);
}

export function createConfigDoctorReport(
    manager: Pick<ConfigManager, 'load' | 'getConfigPath' | 'getLoadMetadata'>,
    options: {
        env?: NodeJS.ProcessEnv;
        cwd?: string;
        hasExecutable?: (command: string) => boolean;
        configExists?: (configPath: string) => boolean;
        discoverPlugins?: ConfigServiceDependencies['discoverPlugins'];
    } = {},
): Promise<ConfigDoctorReport> {
    const env = options.env ?? process.env;
    const hasExecutable = options.hasExecutable ?? defaultHasExecutable;
    const configExists = options.configExists ?? ((configPath: string) => fs.existsSync(configPath));

    const snapshot = createConfigShowSnapshot(manager, env, options.cwd ?? process.cwd());
    const effectiveConfig = snapshot.config;
    const effectivePrimaryModel = resolveAgentLLMConfig(effectiveConfig);
    const checks: ConfigDoctorCheck[] = [];
    const activeSources = snapshot.sources;

    checks.push({
        name: 'Config file',
        status: activeSources.length > 0 || configExists(snapshot.configPath) ? 'ok' : 'warn',
        message: activeSources.length > 0
            ? `Loaded ${activeSources.length} config layers: ${activeSources.map((source) => `${source.kind}:${source.path}`).join(', ')}`
            : `No config file found, will use defaults: ${snapshot.configPath}`,
    });

    checks.push({
        name: 'LLM provider',
        status: 'ok',
        message: `${effectivePrimaryModel.provider} / ${effectivePrimaryModel.model}`,
    });

    checks.push({
        name: 'Default agent',
        status: 'ok',
        message: resolveDefaultAgentName(effectiveConfig),
    });

    const llmKeyFromEnv = snapshot.appliedEnvVars.includes('XQODER_LLM_API_KEY');
    const hasApiKey = effectivePrimaryModel.apiKey.trim().length > 0 || llmKeyFromEnv;
    checks.push({
        name: 'LLM API key',
        status: hasApiKey ? 'ok' : 'error',
        message: hasApiKey
            ? `Configured (${llmKeyFromEnv ? 'env' : 'config'})`
            : 'Missing LLM API key. Run xqoder config init --api-key <key> or set XQODER_LLM_API_KEY',
    });

    const enabledProviders = Object.entries(effectiveConfig.providers ?? {})
        .filter(([, provider]) => provider?.disabled !== true);
    checks.push({
        name: 'Providers',
        status: enabledProviders.length > 0 ? 'ok' : 'warn',
        message: enabledProviders.length > 0
            ? `${enabledProviders.length} provider(s) enabled`
            : 'No provider is currently enabled',
    });

    const hasVercelToken = Boolean(env['VERCEL_TOKEN']?.trim());
    checks.push({
        name: 'Vercel token',
        status: hasVercelToken ? 'ok' : 'warn',
        message: hasVercelToken
            ? 'VERCEL_TOKEN detected'
            : 'VERCEL_TOKEN not detected. Before deploying, export VERCEL_TOKEN=...',
    });

    const hasVercelScope = Boolean(effectiveConfig.vercel?.scope?.trim());
    const vercelScopeFromEnv = snapshot.appliedEnvVars.includes('XQODER_VERCEL_SCOPE');
    checks.push({
        name: 'Vercel scope',
        status: hasVercelScope ? 'ok' : 'warn',
        message: hasVercelScope
            ? `Default scope: ${effectiveConfig.vercel?.scope} (${vercelScopeFromEnv ? 'env' : 'config'})`
            : 'Default Vercel scope not configured. Pass --scope during deploy, or run xqoder config init --vercel-scope <scope>',
    });

    const hasRg = hasExecutable('rg');
    checks.push({
        name: 'ripgrep',
        status: hasRg ? 'ok' : 'warn',
        message: hasRg
            ? 'rg detected, available for sandboxed search_code'
            : 'rg not detected. Please install ripgrep, otherwise search_code will be unavailable',
    });

    const sandboxMode = effectiveConfig.sandbox?.mode ?? 'project';
    checks.push({
        name: 'Sandbox mode',
        status: sandboxMode === 'full-access' ? 'warn' : 'ok',
        message: sandboxMode === 'full-access'
            ? 'Currently in full-access mode, high risk: Agent can access files on the entire computer'
            : sandboxMode === 'paths'
                ? `Currently in paths mode, additional allowed paths count: ${effectiveConfig.sandbox?.allowedPaths.length ?? 0}`
                : 'Currently in project mode, only project directory accessible',
    });

    const enabledMcpServers = effectiveConfig.mcp?.servers.filter((server) => server.enabled !== false) ?? [];
    checks.push({
        name: 'MCP servers',
        status: enabledMcpServers.length > 0 ? 'ok' : 'warn',
        message: enabledMcpServers.length > 0
            ? `${enabledMcpServers.length} MCP server(s) enabled. Run xqoder mcp doctor to check connectivity`
            : 'No MCP server enabled. For external tool bridging, run xqoder mcp add ...',
    });

    for (const server of enabledMcpServers) {
        const command = server.command?.trim();
        const commandAvailable = command
            ? commandExists(command, hasExecutable)
            : server.transport === 'http' || server.transport === 'sse';
        checks.push({
            name: `MCP ${server.name}`,
            status: commandAvailable ? 'ok' : 'warn',
            message: commandAvailable
                ? command
                    ? `Command available: ${command}`
                    : `Remote transport available: ${server.transport ?? 'stdio'} ${server.url ?? '-'}`
                : `Command unavailable: ${command ?? '-'}`,
        });
    }

    const enabledLspServers = effectiveConfig.lsp?.servers.filter((server) => server.enabled !== false) ?? [];
    checks.push({
        name: 'LSP servers',
        status: enabledLspServers.length > 0 ? 'ok' : 'warn',
        message: enabledLspServers.length > 0
            ? `${enabledLspServers.length} LSP server(s) enabled. Run xqoder lsp doctor to check capabilities`
            : 'No LSP server enabled. For multi-language code understanding, run xqoder lsp add ...',
    });

    for (const server of enabledLspServers) {
        const transport = server.transport ?? 'stdio';
        const commandAvailable = server.command
            ? commandExists(server.command, hasExecutable)
            : true;
        const endpoint = isTcpServerConfig(server)
            ? `${server.host}:${server.port}`
            : undefined;
        checks.push({
            name: `LSP ${server.name}`,
            status: commandAvailable ? 'ok' : 'warn',
            message: transport === 'tcp'
                ? commandAvailable
                    ? `TCP endpoint=${endpoint} extensions=${server.extensions.join(',') || '-'}${server.command ? ` bootstrap=${server.command}` : ''}`
                    : `TCP bootstrap command unavailable: ${server.command}`
                : commandAvailable
                    ? `Command available: ${server.command} extensions=${server.extensions.join(',') || '-'}`
                    : `Command unavailable: ${server.command}`,
        });
    }

    const pluginResult = options.discoverPlugins
        ? options.discoverPlugins({
            cwd: options.cwd,
            pluginConfig: effectiveConfig.plugins,
            productVersion: getXQoderVersion(),
            productName: 'xqoder',
        })
        : discoverCommandRegistrationsWithReport({
            cwd: options.cwd,
            pluginConfig: effectiveConfig.plugins,
            productVersion: getXQoderVersion(),
            productName: 'xqoder',
        });

    return Promise.resolve(pluginResult).then((plugins) => ({
        ok: checks.every((check) => check.status !== 'error'),
        configPath: snapshot.configPath,
        appliedEnvVars: snapshot.appliedEnvVars,
        sources: snapshot.sources,
        checks,
        plugins: plugins.report,
    }));
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
