import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    ConfigManager,
    type ConfigSourceInfo,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveConfigWithEnvOverrides,
    type LSPServerConfig,
    type LSPTcpServerConfig,
    type XQoderConfig,
} from '@xqoder/shared';
import {
    discoverCommandRegistrationsWithReport,
    type CommandPluginDiscoveryResult,
} from '../../plugins/command-plugins.js';
import { getXQoderVersion } from '../../cli/version.js';
import { MISSING_API_KEY_GUIDANCE } from './api-key-guidance.js';

interface ConfigDoctorDependencies {
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

export function createConfigDoctorReport(
    manager: Pick<ConfigManager, 'load' | 'getConfigPath' | 'getLoadMetadata'>,
    options: {
        env?: NodeJS.ProcessEnv;
        cwd?: string;
        hasExecutable?: (command: string) => boolean;
        configExists?: (configPath: string) => boolean;
        discoverPlugins?: ConfigDoctorDependencies['discoverPlugins'];
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
            : MISSING_API_KEY_GUIDANCE,
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
