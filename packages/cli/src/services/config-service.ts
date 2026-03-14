/**
 * Config 业务逻辑层（Day 37）
 * 负责：init 合并选项并持久化、show 快照与脱敏、doctor 诊断。
 * command 层仅做参数解析与调用本 service。
 */
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
import { discoverCommandRegistrationsWithReport, type CommandPluginDiscoveryResult } from '../command-plugins.js';
import { getXQoderVersion } from '../version.js';

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
            ? `已加载 ${activeSources.length} 层配置: ${activeSources.map((source) => `${source.kind}:${source.path}`).join(', ')}`
            : `未找到配置文件，将使用默认值: ${snapshot.configPath}`,
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
            ? `已配置 (${llmKeyFromEnv ? 'env' : 'config'})`
            : '缺少 LLM API key。运行 xqoder config init --api-key <key> 或设置 XQODER_LLM_API_KEY',
    });

    const enabledProviders = Object.entries(effectiveConfig.providers ?? {})
        .filter(([, provider]) => provider?.disabled !== true);
    checks.push({
        name: 'Providers',
        status: enabledProviders.length > 0 ? 'ok' : 'warn',
        message: enabledProviders.length > 0
            ? `${enabledProviders.length} 个 provider 已启用`
            : '当前没有启用的 provider',
    });

    const hasVercelToken = Boolean(env['VERCEL_TOKEN']?.trim());
    checks.push({
        name: 'Vercel token',
        status: hasVercelToken ? 'ok' : 'warn',
        message: hasVercelToken
            ? '已检测到 VERCEL_TOKEN'
            : '未检测到 VERCEL_TOKEN。部署前需要 export VERCEL_TOKEN=...',
    });

    const hasVercelScope = Boolean(effectiveConfig.vercel?.scope?.trim());
    const vercelScopeFromEnv = snapshot.appliedEnvVars.includes('XQODER_VERCEL_SCOPE');
    checks.push({
        name: 'Vercel scope',
        status: hasVercelScope ? 'ok' : 'warn',
        message: hasVercelScope
            ? `默认 scope: ${effectiveConfig.vercel?.scope} (${vercelScopeFromEnv ? 'env' : 'config'})`
            : '未配置默认 Vercel scope。可在 deploy 时传 --scope，或运行 xqoder config init --vercel-scope <scope>',
    });

    const hasRg = hasExecutable('rg');
    checks.push({
        name: 'ripgrep',
        status: hasRg ? 'ok' : 'warn',
        message: hasRg
            ? '已检测到 rg，可用于 sandboxed search_code'
            : '未检测到 rg。请安装 ripgrep，否则 search_code 会不可用',
    });

    const sandboxMode = effectiveConfig.sandbox?.mode ?? 'project';
    checks.push({
        name: 'Sandbox mode',
        status: sandboxMode === 'full-access' ? 'warn' : 'ok',
        message: sandboxMode === 'full-access'
            ? '当前为 full-access，高风险：Agent 可访问整台电脑上的文件'
            : sandboxMode === 'paths'
                ? `当前为 paths，额外允许路径数: ${effectiveConfig.sandbox?.allowedPaths.length ?? 0}`
                : '当前为 project，仅允许访问项目目录',
    });

    const enabledMcpServers = effectiveConfig.mcp?.servers.filter((server) => server.enabled !== false) ?? [];
    checks.push({
        name: 'MCP servers',
        status: enabledMcpServers.length > 0 ? 'ok' : 'warn',
        message: enabledMcpServers.length > 0
            ? `已启用 ${enabledMcpServers.length} 个 MCP server。可运行 xqoder mcp doctor 查看连通性`
            : '未启用 MCP server。如需外部工具桥接，可运行 xqoder mcp add ...',
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
                    ? `命令可用: ${command}`
                    : `远程传输可用: ${server.transport ?? 'stdio'} ${server.url ?? '-'}`
                : `命令不可用: ${command ?? '-'}`,
        });
    }

    const enabledLspServers = effectiveConfig.lsp?.servers.filter((server) => server.enabled !== false) ?? [];
    checks.push({
        name: 'LSP servers',
        status: enabledLspServers.length > 0 ? 'ok' : 'warn',
        message: enabledLspServers.length > 0
            ? `已启用 ${enabledLspServers.length} 个 LSP server。可运行 xqoder lsp doctor 查看能力`
            : '未启用 LSP server。如需多语言代码理解，可运行 xqoder lsp add ...',
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
                    : `TCP bootstrap 命令不可用: ${server.command}`
                : commandAvailable
                    ? `命令可用: ${server.command} extensions=${server.extensions.join(',') || '-'}`
                    : `命令不可用: ${server.command}`,
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

    logger.success('XQoder 配置已初始化');
    logger.info(`Provider: ${resolveAgentLLMConfig(nextConfig).provider}`);
    logger.info(`Model: ${resolveAgentLLMConfig(nextConfig).model}`);
    logger.info(`Default agent: ${resolveDefaultAgentName(nextConfig)}`);
    logger.info(`Deploy target: ${nextConfig.defaultDeployTarget ?? '未设置'}`);
    logger.info(`Vercel scope: ${nextConfig.vercel?.scope ?? '未设置'}`);
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
        logger.success('配置检查通过');
    } else {
        logger.error('配置检查未通过');
    }
}
