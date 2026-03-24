// ============================================================
// XQoder 全局配置管理
// ============================================================

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DeployTarget } from './deploy-types.js';
import type { LLMProviderConfig, LLMProviderName } from './llm-types.js';
import {
    DEFAULT_CONTEXT_PATHS,
    createDefaultShellConfig,
    normalizeCompactionConfig,
    normalizeContextPaths,
    normalizeFormatterConfig,
    normalizeLSPSettings,
    normalizeMCPSettings,
    normalizePluginPreferences,
    normalizeSandboxSettings,
    normalizeShellConfig,
    normalizeTuiSettings,
    normalizeWatcherConfig,
} from './config-normalization.js';
import {
    type AgentSettings,
    type AgentSettingsMap,
    type CommandTemplateSettings,
    type CompactionConfig,
    type FormatterConfig,
    type LLMModelReference,
    type LSPServerConfig,
    type LSPSettings,
    type MCPServerConfig,
    type MCPSettings,
    type PermissionSettings,
    type PluginPreferences,
    type ProviderSettings,
    type ProviderSettingsMap,
    type SandboxMode,
    type SandboxSettings,
    type ShellConfig,
    type TuiConfig,
    type TuiMouseMode,
    type TuiPreferences,
    type WatcherConfig,
    type XQoderConfig,
} from './config-types.js';
import { detectProviderFromEnv as detectProviderFromEnvSync } from './provider-detect.js';
import { ConfigError } from './errors.js';
import { getDefaultModelForProvider, normalizeLLMConfig, SUPPORTED_LLM_PROVIDERS } from './llm.js';
import { getXQoderPaths } from './paths.js';

/** 配置文件路径 */
const CONFIG_FILE = getXQoderPaths().configFile;

/** 默认 LLM 配置 */
const DEFAULT_LLM_CONFIG: LLMProviderConfig = normalizeLLMConfig({
    provider: 'openai',
});

function createDefaultConfig(env: NodeJS.ProcessEnv = process.env): XQoderConfig {
    return {
        theme: 'default',
        tui: {
            mouseMode: 'terminal',
            scrollStep: 3,
            inertiaDecayThreshold: 0.3,
            inertiaMaxStep: 20,
        },
        llm: DEFAULT_LLM_CONFIG,
        providers: {
            openai: {
                apiKey: '',
                defaultModel: DEFAULT_LLM_CONFIG.model,
                baseUrl: DEFAULT_LLM_CONFIG.baseUrl,
                maxTokens: DEFAULT_LLM_CONFIG.maxTokens,
                temperature: DEFAULT_LLM_CONFIG.temperature,
                disabled: false,
            },
        },
        defaultAgent: 'general',
        agents: {},
        instructions: [],
        commands: {},
        permissions: {
            defaultMode: 'ask',
            tools: {},
        },
        vercel: {},
        sandbox: {
            mode: 'full-access',
            allowedPaths: [],
        },
        mcp: {
            servers: [],
        },
        lsp: {
            servers: [],
        },
        server: undefined,
        share: 'manual',
        autoupdate: true,
        keybinds: undefined,
        debug: false,
        recentProjects: [],
        contextPaths: DEFAULT_CONTEXT_PATHS,
        shell: createDefaultShellConfig(env),
        plugins: {
            enabled: [],
            disabled: [],
            paths: [],
            allowIncompatible: false,
        },
    };
}

function getProviderCredentialFilePaths(provider: string, credentialDir?: string): string[] {
    const baseDir = credentialDir ?? path.dirname(CONFIG_FILE);
    const primaryPath = path.join(baseDir, 'credentials', `${provider}.key`);
    const legacyPath = path.join(getXQoderPaths().dataDir, 'credentials', `${provider}.key`);
    return Array.from(new Set([primaryPath, legacyPath]));
}

function loadProviderCredentialFromFile(provider: string, credentialDir?: string): string | undefined {
    const credentialFiles = getProviderCredentialFilePaths(provider, credentialDir);
    for (const credentialFile of credentialFiles) {
        try {
            if (!fs.existsSync(credentialFile)) {
                continue;
            }
            const key = fs.readFileSync(credentialFile, 'utf-8').trim();
            if (key.length > 0) {
                return key;
            }
        } catch {
            // try next credential location
        }
    }
    return undefined;
}

export interface ResolvedConfigResult {
    config: XQoderConfig;
    appliedEnvVars: string[];
}

export interface ConfigLoadOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    explicitConfigPath?: string;
    mode?: 'layered' | 'single';
}

export interface ConfigSourceInfo {
    kind: 'single' | 'global' | 'xdg' | 'project' | 'explicit';
    path: string;
    exists: boolean;
}

export interface ConfigLoadMetadata {
    sources: ConfigSourceInfo[];
}

export interface ConfigManagerOptions {
    configPath?: string;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
}

/**
 * 配置管理器
 * 读写 ~/.xqoder/config.json
 */
export class ConfigManager {
    private config: XQoderConfig;
    private configPath: string;
    private env: NodeJS.ProcessEnv;
    private cwd?: string;
    private homeDir: string;
    private singleFileMode: boolean;
    private loadMetadata: ConfigLoadMetadata;

    constructor(configPathOrOptions?: string | ConfigManagerOptions) {
        const options = typeof configPathOrOptions === 'string'
            ? { configPath: configPathOrOptions }
            : (configPathOrOptions ?? {});
        this.homeDir = options.homeDir ?? os.homedir();
        this.env = options.env ?? process.env;
        this.cwd = options.cwd;
        this.configPath = options.configPath ?? getXQoderPaths(this.homeDir).configFile;
        this.singleFileMode = options.configPath !== undefined || typeof configPathOrOptions === 'string';
        this.config = normalizeXQoderConfig(createDefaultConfig(this.env));
        this.loadMetadata = {
            sources: [],
        };
    }

    /** 加载配置文件 */
    load(options: ConfigLoadOptions = {}): XQoderConfig {
        try {
            const effectiveEnv = options.env ?? this.env;
            let nextConfig = normalizeXQoderConfig(createDefaultConfig(effectiveEnv));
            const sources = this.resolveConfigSources(options);

            for (const source of sources) {
                if (!source.exists) {
                    continue;
                }

                const raw = fs.readFileSync(source.path, 'utf-8');
                const parsed = JSON.parse(raw) as Partial<XQoderConfig>;
                const normalized = normalizeLoadedConfigShape(parsed);
                const substituted = substituteConfigVars(normalized, effectiveEnv);
                nextConfig = this.mergeConfig(nextConfig, substituted);
            }

            this.config = nextConfig;
            this.loadMetadata = { sources };
        } catch (err) {
            throw new ConfigError(
                `无法读取配置文件 ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
        return this.config;
    }

    /**
     * 保存配置文件。
     * 注意：当前 apiKey 以明文写入文件；生产/CI 建议使用环境变量（如 XQODER_LLM_API_KEY）不持久化 key。
     */
    save(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
            try {
                fs.chmodSync(this.configPath, 0o600);
            } catch {
                // chmod 在部分环境不可用（如部分 Windows），忽略
            }
        } catch (err) {
            throw new ConfigError(
                `无法写入配置文件 ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    /** 获取当前配置 */
    get(): XQoderConfig {
        return this.config;
    }

    /** 获取配置文件路径 */
    getConfigPath(): string {
        return this.configPath;
    }

    /** 获取最近一次 load 的来源信息 */
    getLoadMetadata(): ConfigLoadMetadata {
        return this.loadMetadata;
    }

    /** 更新配置（部分更新） */
    update(partial: Partial<XQoderConfig>): void {
        this.config = this.mergeConfig(this.config, partial);
    }

    /** 直接替换当前配置 */
    set(nextConfig: XQoderConfig): void {
        this.config = normalizeXQoderConfig(nextConfig);
    }

    /** 获取 LLM 配置 */
    getLLMConfig(): LLMProviderConfig {
        return this.config.llm;
    }

    /** 设置 API Key */
    setApiKey(apiKey: string): void {
        const provider = resolveDefaultProviderName(this.config);
        this.config.providers = {
            ...(this.config.providers ?? {}),
            [provider]: {
                ...(this.config.providers?.[provider] ?? {}),
                apiKey,
            },
        };
        this.config.llm = resolveAgentLLMConfig(this.config);
    }

    /** 获取主题设置 */
    getThemeSetting(): string {
        return this.config.theme ?? 'default';
    }

    /** 设置主题并持久化 */
    setThemeSetting(name: string): void {
        this.config = { ...this.config, theme: name };
        this.save();
    }

    /** 获取 TUI 偏好 */
    getTuiSettings(): TuiPreferences {
        return normalizeTuiSettings(this.config.tui);
    }

    /** 设置 TUI 鼠标模式并持久化 */
    setTuiMouseMode(mouseMode: TuiMouseMode): void {
        this.config = {
            ...this.config,
            tui: normalizeTuiSettings({
                ...(this.config.tui ?? {}),
                mouseMode,
            }),
        };
        this.save();
    }

    /** 更新默认 LLM model 并持久化 */
    updateDefaultModel(model: string, provider?: string): void {
        this.config = {
            ...this.config,
            llm: {
                ...this.config.llm,
                model,
                ...(provider ? { provider: provider as LLMProviderName } : {}),
            },
        };
        this.save();
    }

    /** 设置特定 agent 的 model 并持久化 */
    setModelForAgent(agentName: string, model: string, provider?: LLMProviderName): void {
        const agents = { ...(this.config.agents ?? {}) };
        agents[agentName] = {
            ...(agents[agentName] ?? {}),
            model,
            ...(provider ? { provider } : {}),
        };
        this.config = { ...this.config, agents };
        this.save();
    }

    /** 深度合并配置 */
    private mergeConfig(base: XQoderConfig, override: Partial<XQoderConfig>): XQoderConfig {
        return normalizeXQoderConfig({
            ...base,
            ...override,
            vercel: {
                ...(base.vercel ?? {}),
                ...(override.vercel ?? {}),
            },
            providers: mergeProviderSettingsMaps(base.providers, override.providers),
            defaultAgent: override.defaultAgent ?? base.defaultAgent,
            smallModel: override.smallModel ?? base.smallModel,
            agents: mergeAgentSettingsMaps(base.agents, override.agents),
            instructions: override.instructions ?? base.instructions,
            commands: {
                ...(base.commands ?? {}),
                ...(override.commands ?? {}),
            },
            tui: normalizeTuiSettings({
                ...(base.tui ?? {}),
                ...(override.tui ?? {}),
            }),
            permissions: {
                ...(base.permissions ?? {}),
                ...(override.permissions ?? {}),
                tools: {
                    ...(base.permissions?.tools ?? {}),
                    ...(override.permissions?.tools ?? {}),
                },
            },
            sandbox: normalizeSandboxSettings({
                ...(base.sandbox ?? {}),
                ...(override.sandbox ?? {}),
            }),
            mcp: normalizeMCPSettings(override.mcp ?? base.mcp),
            lsp: normalizeLSPSettings(override.lsp ?? base.lsp),
            plugins: normalizePluginPreferences({
                ...(base.plugins ?? {}),
                ...(override.plugins ?? {}),
                enabled: override.plugins?.enabled ?? base.plugins?.enabled,
                disabled: override.plugins?.disabled ?? base.plugins?.disabled,
                paths: override.plugins?.paths ?? base.plugins?.paths,
            }),
        });
    }

    private resolveConfigSources(options: ConfigLoadOptions): ConfigSourceInfo[] {
        if (this.singleFileMode || options.mode === 'single') {
            return [{
                kind: 'single',
                path: this.configPath,
                exists: fs.existsSync(this.configPath),
            }];
        }

        const env = options.env ?? this.env;
        const cwd = path.resolve(options.cwd ?? this.cwd ?? process.cwd());
        const explicitPath = normalizeConfigPath(
            options.explicitConfigPath ?? env['XQODER_CONFIG'],
        );
        const projectPath = resolveProjectConfigPath(cwd);
        const xdgPath = resolveXdgConfigPath(this.homeDir, env);
        const globalPath = resolveGlobalConfigPath(this.homeDir);
        const seen = new Set<string>();

        return [
            { kind: 'global' as const, path: globalPath },
            { kind: 'xdg' as const, path: xdgPath },
            ...(projectPath ? [{ kind: 'project' as const, path: projectPath }] : []),
            ...(explicitPath ? [{ kind: 'explicit' as const, path: explicitPath }] : []),
        ].filter((source) => {
            if (!source.path || seen.has(source.path)) {
                return false;
            }
            seen.add(source.path);
            return true;
        }).map((source) => ({
            ...source,
            exists: fs.existsSync(source.path),
        }));
    }
}

/** 加载 tui.json 配置（OpenCode 风格，独立于主配置） */
export function loadTuiConfig(options?: {
    path?: string;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}): TuiConfig {
    const env = options?.env ?? process.env;
    const homeDir = options?.homeDir ?? os.homedir();
    const paths = getXQoderPaths(homeDir);
    const tuiPath = options?.path ?? env['XQODER_TUI_CONFIG'] ?? paths.tuiConfigFile;

    if (!fs.existsSync(tuiPath)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(tuiPath, 'utf-8');
        const parsed = JSON.parse(stripJsonComments(raw)) as Partial<TuiConfig>;
        return {
            theme: parsed.theme,
            keybinds: parsed.keybinds,
            scroll_speed: parsed.scroll_speed,
            scroll_acceleration: parsed.scroll_acceleration,
            diff_style: parsed.diff_style,
        };
    } catch {
        return {};
    }
}

/** 写入 tui.json（合并现有配置），用于 Theme 等持久化 */
export function writeTuiConfig(updates: Partial<TuiConfig>, options?: { path?: string; homeDir?: string }): void {
    const homeDir = options?.homeDir ?? os.homedir();
    const paths = getXQoderPaths(homeDir);
    const tuiPath = options?.path ?? process.env['XQODER_TUI_CONFIG'] ?? paths.tuiConfigFile;
    const existing = loadTuiConfig({ path: tuiPath, homeDir });
    const merged: TuiConfig = {
        ...existing,
        ...updates,
    };
    const dir = path.dirname(tuiPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tuiPath, JSON.stringify(merged, null, 2), 'utf-8');
}

function stripJsonComments(raw: string): string {
    return raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
}

export function normalizeXQoderConfig(input: Partial<XQoderConfig>): XQoderConfig {
    const legacyLlm = normalizeLLMConfig({
        provider: input.llm?.provider ?? 'openai',
        model: input.llm?.model,
        apiKey: input.llm?.apiKey,
        baseUrl: input.llm?.baseUrl,
        maxTokens: input.llm?.maxTokens,
        temperature: input.llm?.temperature,
    });
    const providers = normalizeProviderSettingsMap(input.providers, legacyLlm);
    const agents = inferAgentProviders(
        normalizeAgentSettingsMap(input.agents),
        providers,
    );
    const defaultAgent = normalizeAgentName(input.defaultAgent)
        || Object.entries(agents).find(([, agent]) => agent.mode === 'primary' && agent.disabled !== true)?.[0]
        || (agents['coder']?.disabled !== true && agents['coder'] ? 'coder' : '')
        || 'general';
    const smallModel = normalizeModelReference(input.smallModel);
    const compatibilityTheme = readCompatibleTuiTheme(input);

    const resolvedLlm = resolveAgentLLMConfigFromState({
        providers,
        defaultAgent,
        agents,
        llm: legacyLlm,
        smallModel,
    });

    return {
        theme: normalizeThemeName(input.theme) ?? compatibilityTheme,
        tui: normalizeTuiSettings(input.tui),
        server: input.server,
        share: input.share ?? 'manual',
        autoupdate: input.autoupdate ?? true,
        keybinds: input.keybinds,
        llm: resolvedLlm,
        providers,
        disabledProviders: normalizeProviderList(input.disabledProviders),
        enabledProviders: normalizeProviderList(input.enabledProviders),
        defaultAgent,
        smallModel,
        agents,
        instructions: normalizeInstructionList(input.instructions),
        commands: normalizeCommandTemplates(input.commands),
        permissions: normalizePermissionSettings(input.permissions),
        defaultDeployTarget: input.defaultDeployTarget,
        vercel: {
            ...(input.vercel ?? {}),
        },
        sandbox: normalizeSandboxSettings(input.sandbox),
        mcp: normalizeMCPSettings(input.mcp),
        lsp: normalizeLSPSettings(input.lsp),
        recentProjects: normalizeRecentProjects(input.recentProjects),
        debug: input.debug ?? false,
        formatter: normalizeFormatterConfig(input.formatter),
        watcher: normalizeWatcherConfig(input.watcher),
        compaction: normalizeCompactionConfig(input.compaction, readCompatibleAutoCompact(input)),
        contextPaths: normalizeContextPaths(input.contextPaths),
        shell: normalizeShellConfig(input.shell),
        plugins: normalizePluginPreferences(input.plugins),
    };
}

export function resolveDefaultAgentName(
    config: Pick<XQoderConfig, 'defaultAgent' | 'agents'>,
): string {
    const configured = normalizeAgentName(config.defaultAgent);
    if (configured) {
        return configured;
    }

    const primary = Object.entries(config.agents ?? {})
        .find(([, agent]) => agent.mode === 'primary' && agent.disabled !== true)?.[0];
    return primary ?? 'general';
}

export function resolveSmallModelConfig(
    config: XQoderConfig,
    fallbackProvider?: LLMProviderName,
): LLMProviderConfig | undefined {
    const reference = normalizeModelReference(config.smallModel);
    if (!reference?.model) {
        return undefined;
    }

    const provider = reference.provider
        ?? fallbackProvider
        ?? resolveDefaultProviderName(config);
    const providerSettings = config.providers?.[provider] ?? {};

    if (providerSettings.disabled) {
        return undefined;
    }

    return normalizeLLMConfig({
        provider,
        model: reference.model,
        apiKey: providerSettings.apiKey ?? (config.llm.provider === provider ? config.llm.apiKey : ''),
        baseUrl: providerSettings.baseUrl ?? (config.llm.provider === provider ? config.llm.baseUrl : undefined),
        maxTokens: providerSettings.maxTokens ?? (config.llm.provider === provider ? config.llm.maxTokens : undefined),
        temperature: providerSettings.temperature ?? (config.llm.provider === provider ? config.llm.temperature : undefined),
    });
}

export function resolveAgentLLMConfig(
    config: XQoderConfig,
    agentName?: string,
    overrides: Partial<LLMProviderConfig> = {},
): LLMProviderConfig {
    return resolveAgentLLMConfigFromState({
        providers: normalizeProviderSettingsMap(config.providers, config.llm),
        defaultAgent: resolveDefaultAgentName(config),
        agents: normalizeAgentSettingsMap(config.agents),
        llm: normalizeLLMConfig(config.llm),
        smallModel: normalizeModelReference(config.smallModel),
    }, agentName, overrides);
}

export function resolveConfigWithEnvOverrides(
    baseConfig: XQoderConfig,
    env: NodeJS.ProcessEnv = process.env,
    options: { credentialDir?: string } = {},
): ResolvedConfigResult {
    const appliedEnvVars: string[] = [];
    const llmOverrides: Partial<LLMProviderConfig> = {};

    let provider = parseProviderEnv(env['XQODER_LLM_PROVIDER']);
    if (provider) {
        llmOverrides.provider = provider;
        appliedEnvVars.push('XQODER_LLM_PROVIDER');
    }

    // Auto-detect provider from environment if no provider configured
    if (!provider && !baseConfig.llm?.provider) {
        const detected = detectProviderFromEnvSync(env);
        if (detected) {
            provider = detected.provider;
            llmOverrides.provider = detected.provider;
            llmOverrides.model = llmOverrides.model ?? detected.model;
            llmOverrides.apiKey = llmOverrides.apiKey ?? detected.apiKey;
            appliedEnvVars.push(`AUTO_DETECT:${detected.provider}`);
        }
    }

    if (env['XQODER_LLM_MODEL']) {
        llmOverrides.model = env['XQODER_LLM_MODEL'];
        appliedEnvVars.push('XQODER_LLM_MODEL');
    }

    if (env['XQODER_LLM_API_KEY']) {
        llmOverrides.apiKey = env['XQODER_LLM_API_KEY'];
        appliedEnvVars.push('XQODER_LLM_API_KEY');
    }

    if (env['XQODER_LLM_BASE_URL']) {
        llmOverrides.baseUrl = env['XQODER_LLM_BASE_URL'];
        appliedEnvVars.push('XQODER_LLM_BASE_URL');
    }

    const defaultDeployTarget = parseDeployTargetEnv(env['XQODER_DEFAULT_DEPLOY_TARGET']);
    if (defaultDeployTarget) {
        appliedEnvVars.push('XQODER_DEFAULT_DEPLOY_TARGET');
    }

    const debugOverride = parseBooleanEnv(env['XQODER_DEBUG']);
    if (debugOverride !== undefined) {
        appliedEnvVars.push('XQODER_DEBUG');
    }

    const xqoderAutoCompact = parseBooleanEnv(env['XQODER_AUTO_COMPACT']);
    if (xqoderAutoCompact !== undefined) {
        appliedEnvVars.push('XQODER_AUTO_COMPACT');
    }
    const opencodeDisableAutoCompact = parseBooleanEnv(env['OPENCODE_DISABLE_AUTOCOMPACT']);
    if (opencodeDisableAutoCompact !== undefined) {
        appliedEnvVars.push('OPENCODE_DISABLE_AUTOCOMPACT');
    }
    const compactionAutoOverride = xqoderAutoCompact ?? (
        opencodeDisableAutoCompact !== undefined
            ? !opencodeDisableAutoCompact
            : undefined
    );

    const vercelScope = env['XQODER_VERCEL_SCOPE'];
    if (vercelScope) {
        appliedEnvVars.push('XQODER_VERCEL_SCOPE');
    }

    const sandboxMode = parseSandboxModeEnv(env['XQODER_SANDBOX_MODE']);
    if (sandboxMode) {
        appliedEnvVars.push('XQODER_SANDBOX_MODE');
    }

    const allowedPaths = parseAllowedPathsEnv(env['XQODER_ALLOWED_PATHS']);
    if (allowedPaths.length > 0) {
        appliedEnvVars.push('XQODER_ALLOWED_PATHS');
    }

    const defaultAgentOverride = normalizeAgentName(env['XQODER_DEFAULT_AGENT']) || undefined;
    if (defaultAgentOverride) {
        appliedEnvVars.push('XQODER_DEFAULT_AGENT');
    }

    const baseDefaultAgent = defaultAgentOverride ?? resolveDefaultAgentName(baseConfig);
    const nextAgents: AgentSettingsMap = {
        ...(baseConfig.agents ?? {}),
    };
    const nextDefaultAgent = {
        ...(nextAgents[baseDefaultAgent] ?? {}),
    };

    if (provider) {
        nextDefaultAgent.provider = provider;
    }
    if (env['XQODER_LLM_MODEL']) {
        nextDefaultAgent.model = env['XQODER_LLM_MODEL'];
    }
    if (provider || env['XQODER_LLM_MODEL']) {
        nextAgents[baseDefaultAgent] = nextDefaultAgent;
    }

    const credentialProvider = nextDefaultAgent.provider
        ?? resolveDefaultProviderName(baseConfig);
    const nextProviders: ProviderSettingsMap = {
        ...(baseConfig.providers ?? {}),
    };

    for (const providerName of new Set<LLMProviderName>([
        ...SUPPORTED_LLM_PROVIDERS,
        ...Object.keys(nextProviders) as LLMProviderName[],
    ])) {
        const existing = nextProviders[providerName];
        const hasInlineKey = Boolean(existing?.apiKey?.trim());
        if (hasInlineKey) {
            continue;
        }
        const credential = loadProviderCredentialFromFile(providerName, options.credentialDir);
        if (!credential) {
            continue;
        }
        nextProviders[providerName] = normalizeProviderSettings(providerName, {
            ...(existing ?? {}),
            apiKey: credential,
        });
        appliedEnvVars.push(`CREDENTIAL_FILE:${providerName}`);
    }

    if (provider || env['XQODER_LLM_API_KEY'] || env['XQODER_LLM_BASE_URL'] || env['XQODER_LLM_MODEL']) {
        nextProviders[credentialProvider] = normalizeProviderSettings(
            credentialProvider,
            {
                ...(nextProviders[credentialProvider] ?? {}),
                ...(env['XQODER_LLM_API_KEY'] ? { apiKey: env['XQODER_LLM_API_KEY'] } : {}),
                ...(env['XQODER_LLM_BASE_URL'] ? { baseUrl: env['XQODER_LLM_BASE_URL'] } : {}),
                ...(env['XQODER_LLM_MODEL'] ? { defaultModel: env['XQODER_LLM_MODEL'] } : {}),
                disabled: false,
            },
        );
    }

    return {
        config: normalizeXQoderConfig({
            ...baseConfig,
            llm: normalizeLLMConfig({
                ...baseConfig.llm,
                ...llmOverrides,
            }),
            providers: nextProviders,
            defaultAgent: baseDefaultAgent,
            agents: nextAgents,
            defaultDeployTarget: defaultDeployTarget ?? baseConfig.defaultDeployTarget,
            debug: debugOverride ?? baseConfig.debug,
            vercel: {
                ...(baseConfig.vercel ?? {}),
                ...(vercelScope ? { scope: vercelScope } : {}),
            },
            sandbox: normalizeSandboxSettings({
                ...(baseConfig.sandbox ?? {}),
                ...(sandboxMode ? { mode: sandboxMode } : {}),
                ...(allowedPaths.length > 0 ? { allowedPaths } : {}),
            }),
            ...(compactionAutoOverride !== undefined
                ? {
                    compaction: {
                        ...(baseConfig.compaction ?? {}),
                        auto: compactionAutoOverride,
                    },
                }
                : {}),
        }),
        appliedEnvVars,
    };
}

function parseProviderEnv(
    value: string | undefined,
): LLMProviderConfig['provider'] | undefined {
    if (value && SUPPORTED_LLM_PROVIDERS.includes(value as LLMProviderName)) {
        return value as LLMProviderConfig['provider'];
    }
    return undefined;
}

function parseDeployTargetEnv(value: string | undefined): DeployTarget | undefined {
    switch (value) {
        case DeployTarget.Vercel:
        case DeployTarget.Cloudflare:
        case DeployTarget.AWS:
        case DeployTarget.Custom:
            return value;
        default:
            return undefined;
    }
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return undefined;
}

function parseSandboxModeEnv(value: string | undefined): SandboxMode | undefined {
    if (value === 'project' || value === 'paths' || value === 'full-access') {
        return value;
    }
    return undefined;
}

function parseAllowedPathsEnv(value: string | undefined): string[] {
    if (!value) {
        return [];
    }

    return value
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeConfigPath(value: string | undefined): string | undefined {
    if (!value?.trim()) {
        return undefined;
    }

    return path.resolve(value.trim());
}

function resolveGlobalConfigPath(homeDir: string): string {
    const xqoderPath = getXQoderPaths(homeDir).configFile;
    if (fs.existsSync(xqoderPath)) {
        return xqoderPath;
    }

    return path.join(homeDir, '.opencode.json');
}

function resolveProjectConfigPath(cwd: string): string | undefined {
    let current = cwd;

    while (true) {
        const nestedPath = path.join(current, '.xqoder', 'config.json');
        if (fs.existsSync(nestedPath)) {
            return nestedPath;
        }

        const flatPath = path.join(current, '.xqoder.json');
        if (fs.existsSync(flatPath)) {
            return flatPath;
        }

        const opencodePath = path.join(current, '.opencode.json');
        if (fs.existsSync(opencodePath)) {
            return opencodePath;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

function resolveXdgConfigPath(homeDir: string, env: NodeJS.ProcessEnv): string {
    const configHome = env['XDG_CONFIG_HOME']?.trim()
        ? path.resolve(env['XDG_CONFIG_HOME'].trim())
        : path.join(homeDir, '.config');
    const xqoderPath = path.join(configHome, 'xqoder', 'config.json');
    if (fs.existsSync(xqoderPath)) {
        return xqoderPath;
    }

    return path.join(configHome, 'opencode', '.opencode.json');
}

function normalizeProviderSettingsMap(
    settings: ProviderSettingsMap | undefined,
    legacyLlm: LLMProviderConfig,
): ProviderSettingsMap {
    const normalized = Object.fromEntries(
        Object.entries(settings ?? {})
            .filter((entry): entry is [LLMProviderName, ProviderSettings] => SUPPORTED_LLM_PROVIDERS.includes(entry[0] as LLMProviderName))
            .map(([provider, value]) => [provider, normalizeProviderSettings(provider as LLMProviderName, value)]),
    ) as ProviderSettingsMap;

    normalized[legacyLlm.provider] = normalizeProviderSettings(legacyLlm.provider, {
        ...(normalized[legacyLlm.provider] ?? {}),
        apiKey: normalized[legacyLlm.provider]?.apiKey ?? legacyLlm.apiKey,
        defaultModel: normalized[legacyLlm.provider]?.defaultModel ?? legacyLlm.model,
        baseUrl: normalized[legacyLlm.provider]?.baseUrl ?? legacyLlm.baseUrl,
        maxTokens: normalized[legacyLlm.provider]?.maxTokens ?? legacyLlm.maxTokens,
        temperature: normalized[legacyLlm.provider]?.temperature ?? legacyLlm.temperature,
        disabled: normalized[legacyLlm.provider]?.disabled ?? false,
    });

    return normalized;
}

function normalizeProviderSettings(
    provider: LLMProviderName,
    settings: ProviderSettings = {},
): ProviderSettings {
    return {
        apiKey: settings.apiKey?.trim() || '',
        defaultModel: settings.defaultModel?.trim() || getDefaultModelForProvider(provider),
        baseUrl: settings.baseUrl?.trim() || undefined,
        maxTokens: normalizeOptionalNumber(settings.maxTokens),
        temperature: normalizeOptionalNumber(settings.temperature),
        disabled: settings.disabled ?? false,
    };
}

function mergeProviderSettingsMaps(
    base: ProviderSettingsMap | undefined,
    override: ProviderSettingsMap | undefined,
): ProviderSettingsMap {
    const merged: ProviderSettingsMap = {
        ...(base ?? {}),
    };

    for (const [provider, settings] of Object.entries(override ?? {})) {
        merged[provider as LLMProviderName] = {
            ...(merged[provider as LLMProviderName] ?? {}),
            ...(settings ?? {}),
        };
    }

    return merged;
}

function normalizeAgentSettingsMap(settings: AgentSettingsMap | undefined): AgentSettingsMap {
    return Object.fromEntries(
        Object.entries(settings ?? {})
            .map(([name, value]) => [normalizeAgentName(name), normalizeAgentSettings(value)])
            .filter(([name]) => Boolean(name)),
    );
}

function mergeAgentSettingsMaps(
    base: AgentSettingsMap | undefined,
    override: AgentSettingsMap | undefined,
): AgentSettingsMap {
    const merged: AgentSettingsMap = {
        ...(base ?? {}),
    };

    for (const [name, settings] of Object.entries(override ?? {})) {
        merged[name] = {
            ...(merged[name] ?? {}),
            ...(settings ?? {}),
        };
    }

    return merged;
}

function normalizeAgentSettings(settings: AgentSettings = {}): AgentSettings {
    return {
        mode: settings.mode,
        provider: settings.provider,
        model: settings.model?.trim() || undefined,
        maxTokens: normalizeOptionalNumber(settings.maxTokens),
        temperature: normalizeOptionalNumber(settings.temperature),
        prompt: settings.prompt?.trim() || undefined,
        instructions: normalizeInstructionList(settings.instructions),
        tools: (settings.tools ?? []).map((value) => value.trim()).filter(Boolean),
        cwd: settings.cwd?.trim() || undefined,
        permissionMode: settings.permissionMode,
        disabled: settings.disabled ?? false,
        useSmallModel: settings.useSmallModel ?? false,
    };
}

function inferAgentProviders(
    agents: AgentSettingsMap,
    providers: ProviderSettingsMap,
): AgentSettingsMap {
    return Object.fromEntries(
        Object.entries(agents).map(([name, agent]) => {
            if (agent.provider || !agent.model) {
                return [name, agent];
            }

            const inferredProvider = inferProviderFromModel(agent.model, providers);
            if (!inferredProvider) {
                return [name, agent];
            }

            return [name, {
                ...agent,
                provider: inferredProvider,
            }];
        }),
    );
}

function inferProviderFromModel(
    model: string,
    providers: ProviderSettingsMap,
): LLMProviderName | undefined {
    const normalizedModel = model.trim().toLowerCase();
    const inferredProvider = normalizedModel.startsWith('openrouter.')
        ? 'openrouter'
        : normalizedModel.startsWith('azure.')
            ? 'azure'
            : normalizedModel.startsWith('bedrock.')
                ? 'bedrock'
                : normalizedModel.startsWith('copilot.')
                    ? 'copilot'
                    : normalizedModel.startsWith('vertexai.')
                        ? 'vertexai'
                        : normalizedModel.startsWith('claude-')
                            ? 'anthropic'
                            : normalizedModel.startsWith('gpt-') || normalizedModel.startsWith('o1') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('o4')
                                ? 'openai'
                                : normalizedModel.startsWith('gemini-')
                                    ? 'gemini'
                                    : normalizedModel.startsWith('grok-')
                                        ? 'xai'
                                        : normalizedModel === 'qwen-qwq' || normalizedModel.includes('llama-') || normalizedModel.includes('deepseek-r1-distill')
                                            ? 'groq'
                                            : normalizedModel.startsWith('qwen-')
                                                ? 'dashscope'
                                                : undefined;

    if (!inferredProvider) {
        return undefined;
    }

    return providers[inferredProvider]?.disabled === true
        ? undefined
        : inferredProvider;
}

function normalizeInstructionList(value: string[] | undefined): string[] {
    return (value ?? []).map((entry) => entry.trim()).filter(Boolean);
}

function normalizeCommandTemplates(
    value: Record<string, CommandTemplateSettings> | undefined,
): Record<string, CommandTemplateSettings> {
    const templates: Record<string, CommandTemplateSettings> = {};

    for (const [name, template] of Object.entries(value ?? {})) {
        const normalizedName = name.trim();
        const prompt = template.prompt?.trim() || '';
        if (!normalizedName || !prompt) {
            continue;
        }

        templates[normalizedName] = {
            description: template.description?.trim() || undefined,
            prompt,
            agent: normalizeAgentName(template.agent) || undefined,
        };
    }

    return templates;
}

function normalizePermissionSettings(settings: PermissionSettings | undefined): PermissionSettings {
    return {
        defaultMode: settings?.defaultMode ?? 'ask',
        tools: Object.fromEntries(
            Object.entries(settings?.tools ?? {})
                .map(([toolName, mode]) => [toolName.trim(), mode])
                .filter(([toolName, mode]) => toolName.length > 0 && (mode === 'allow' || mode === 'ask' || mode === 'deny')),
        ),
    };
}

function normalizeRecentProjects(value: string[] | undefined): string[] {
    return Array.from(new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeModelReference(value: LLMModelReference | undefined): LLMModelReference | undefined {
    if (!value?.model?.trim()) {
        return undefined;
    }

    return {
        provider: value.provider,
        model: value.model.trim(),
    };
}

function normalizeAgentName(value: string | undefined): string {
    return value?.trim() || '';
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

function resolveDefaultProviderName(
    config: Pick<XQoderConfig, 'llm' | 'providers' | 'defaultAgent' | 'agents'>,
): LLMProviderName {
    const defaultAgent = resolveDefaultAgentName(config);
    const configuredProvider = config.agents?.[defaultAgent]?.provider;
    if (configuredProvider) {
        return configuredProvider;
    }

    if (config.llm.provider) {
        return config.llm.provider;
    }

    const firstEnabled = Object.entries(config.providers ?? {})
        .find(([, provider]) => provider?.disabled !== true)?.[0];
    return (firstEnabled as LLMProviderName | undefined) ?? 'openai';
}

function resolveAgentLLMConfigFromState(
    state: {
        providers: ProviderSettingsMap;
        defaultAgent: string;
        agents: AgentSettingsMap;
        llm: LLMProviderConfig;
        smallModel?: LLMModelReference;
    },
    agentName?: string,
    overrides: Partial<LLMProviderConfig> = {},
): LLMProviderConfig {
    const targetName = normalizeAgentName(agentName) || state.defaultAgent;
    const agent = state.agents[targetName] ?? {};
    const primaryProvider = overrides.provider
        ?? agent.provider
        ?? resolveDefaultProviderName({
            llm: state.llm,
            providers: state.providers,
            defaultAgent: state.defaultAgent,
            agents: state.agents,
        });

    if (agent.useSmallModel && !overrides.provider && !overrides.model && state.smallModel?.model) {
        const smallProvider = state.smallModel.provider ?? primaryProvider;
        const smallSettings = state.providers[smallProvider] ?? {};
        if (!smallSettings.disabled) {
            return normalizeLLMConfig({
                provider: smallProvider,
                model: state.smallModel.model,
                apiKey: smallSettings.apiKey ?? '',
                baseUrl: smallSettings.baseUrl,
                maxTokens: smallSettings.maxTokens,
                temperature: smallSettings.temperature,
            });
        }
    }

    const providerSettings = state.providers[primaryProvider] ?? {};
    const legacySameProvider = state.llm.provider === primaryProvider ? state.llm : undefined;

    return normalizeLLMConfig({
        provider: primaryProvider,
        model: overrides.model
            ?? agent.model
            ?? providerSettings.defaultModel
            ?? legacySameProvider?.model,
        apiKey: overrides.apiKey
            ?? providerSettings.apiKey
            ?? legacySameProvider?.apiKey
            ?? '',
        baseUrl: overrides.baseUrl
            ?? providerSettings.baseUrl
            ?? legacySameProvider?.baseUrl,
        maxTokens: overrides.maxTokens
            ?? agent.maxTokens
            ?? providerSettings.maxTokens
            ?? legacySameProvider?.maxTokens,
        temperature: overrides.temperature
            ?? agent.temperature
            ?? providerSettings.temperature
            ?? legacySameProvider?.temperature,
    });
}

// ============================================================
// Variable substitution — {env:VAR} and {file:path}
// ============================================================

const VAR_PATTERN = /\{(env|file):([^}]+)\}/g;

/**
 * Substitute `{env:VAR_NAME}` and `{file:path}` placeholders in a string.
 * - `{env:VAR}` → value of environment variable VAR (empty string if not set)
 * - `{file:path}` → contents of the file at path (empty string if unreadable)
 */
export function substituteVars(input: string, env: NodeJS.ProcessEnv = process.env): string {
    return input.replace(VAR_PATTERN, (_match, type: string, ref: string) => {
        if (type === 'env') {
            return env[ref] ?? '';
        }
        if (type === 'file') {
            try {
                const resolved = ref.startsWith('~')
                    ? path.join(os.homedir(), ref.slice(1))
                    : ref;
                return fs.readFileSync(resolved, 'utf8').trim();
            } catch {
                return '';
            }
        }
        return '';
    });
}

/**
 * Recursively apply variable substitution to all string values in a config object.
 */
export function substituteConfigVars<T>(obj: T, env?: NodeJS.ProcessEnv): T {
    if (typeof obj === 'string') {
        return substituteVars(obj, env) as unknown as T;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => substituteConfigVars(item, env)) as unknown as T;
    }
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            result[key] = substituteConfigVars(value, env);
        }
        return result as T;
    }
    return obj;
}

function normalizeLoadedConfigShape(input: Partial<XQoderConfig>): Partial<XQoderConfig> {
    const autoCompact = readCompatibleAutoCompact(input);
    const compatibilityTheme = readCompatibleTuiTheme(input);
    const inferredDefaultAgent = inferCompatibleDefaultAgent(input);

    return {
        ...input,
        ...(inferredDefaultAgent ? { defaultAgent: input.defaultAgent ?? inferredDefaultAgent } : {}),
        ...(compatibilityTheme ? { theme: input.theme ?? compatibilityTheme } : {}),
        ...(autoCompact !== undefined
            ? {
                compaction: {
                    ...(input.compaction ?? {}),
                    auto: autoCompact,
                },
            }
            : {}),
    };
}

function readCompatibleTuiTheme(input: Partial<XQoderConfig>): string | undefined {
    const rawTui = input.tui as ({ theme?: string } & Partial<TuiPreferences>) | undefined;
    return normalizeThemeName(rawTui?.theme);
}

function readCompatibleAutoCompact(input: Partial<XQoderConfig>): boolean | undefined {
    const compatibilityValue = (input as Partial<XQoderConfig> & { autoCompact?: boolean }).autoCompact;
    return typeof compatibilityValue === 'boolean'
        ? compatibilityValue
        : undefined;
}

function normalizeThemeName(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function inferCompatibleDefaultAgent(input: Partial<XQoderConfig>): string | undefined {
    if (normalizeAgentName(input.defaultAgent)) {
        return undefined;
    }

    const agents = input.agents ?? {};
    const hasExplicitPrimaryAgent = Object.values(agents).some((agent) => agent?.mode === 'primary');
    if (hasExplicitPrimaryAgent) {
        return undefined;
    }

    return agents['coder'] ? 'coder' : undefined;
}

function normalizeProviderList(providers: LLMProviderName[] | undefined): LLMProviderName[] | undefined {
    if (!providers?.length) {
        return undefined;
    }

    return providers.filter(p => SUPPORTED_LLM_PROVIDERS.includes(p));
}

/** 全局配置管理器实例 */
export const configManager = new ConfigManager();
