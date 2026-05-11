// ============================================================
// XQoder Global Configuration Management
// ============================================================

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectProviderFromEnv as detectProviderFromEnvSync } from './provider-detect.js';
import {
    DeployTarget,
    type XQoderConfig,
    type ProviderSettingsMap,
    type LLMProviderConfig,
    type LLMProviderName,
    type AgentSettingsMap,
    type SandboxMode,
} from './types.js';
import { ConfigError } from './errors.js';
import { normalizeLLMConfig, SUPPORTED_LLM_PROVIDERS } from './llm.js';
import { getXQoderPaths } from './paths.js';
import {
    createDefaultConfig,
    loadProviderCredentialFromFile,
} from './config-defaults.js';
import {
    mergeXQoderConfig,
    normalizeAgentName,
    normalizeLoadedConfigShape,
    normalizeProviderSettings,
    normalizeSandboxSettings,
    normalizeXQoderConfig,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveDefaultProviderName,
    substituteConfigVars,
} from './config-normalizers.js';

export {
    loadTuiConfig,
    normalizeXQoderConfig,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveSmallModelConfig,
    substituteConfigVars,
    substituteVars,
    writeTuiConfig,
} from './config-normalizers.js';

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
 * Configuration Manager
 * Manages read/write operations for ~/.xqoder/config.json
 */
export class ConfigManager {
    private config: XQoderConfig;
    private configPath: string;
    private env: NodeJS.ProcessEnv;
    private cwd: string | undefined;
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

    /** Load configuration file */
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
                `Failed to read configuration file ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
        return this.config;
    }

    /**
     * Save configuration file.
     * Note: Current apiKey is written to the file in plain text; for production/CI,
     * it is recommended to use environment variables (e.g. XQODER_LLM_API_KEY) to avoid persisting the key.
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
                // chmod may be unavailable in some environments (e.g. some Windows), ignore
            }
        } catch (err) {
            throw new ConfigError(
                `Failed to write configuration file ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    /** Get current configuration */
    get(): XQoderConfig {
        return this.config;
    }

    /** Get configuration file path */
    getConfigPath(): string {
        return this.configPath;
    }

    /** Get metadata for the most recent load */
    getLoadMetadata(): ConfigLoadMetadata {
        return this.loadMetadata;
    }

    /** Update configuration (partial update) */
    update(partial: Partial<XQoderConfig>): void {
        this.config = this.mergeConfig(this.config, partial);
    }

    /** Replace current configuration directly */
    set(nextConfig: XQoderConfig): void {
        this.config = normalizeXQoderConfig(nextConfig);
    }

    /** Get LLM configuration */
    getLLMConfig(): LLMProviderConfig {
        return this.config.llm;
    }

    /** Set API Key */
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

    /** Get theme setting */
    getThemeSetting(): string {
        return this.config.theme ?? 'default';
    }

    /** Set theme and persist */
    setThemeSetting(name: string): void {
        this.config = { ...this.config, theme: name };
        this.save();
    }

    /** Update default LLM model and persist */
    updateDefaultModel(model: string, provider?: string): void {
        this.config = {
            ...this.config,
            llm: {
                ...this.config.llm,
                model,
                ...(provider ? { provider: provider as import('./types.js').LLMProviderName } : {}),
            },
        };
        this.save();
    }

    /** Set model for a specific agent and persist */
    setModelForAgent(agentName: string, model: string, provider?: import('./types.js').LLMProviderName): void {
        const agents = { ...(this.config.agents ?? {}) };
        agents[agentName] = {
            ...(agents[agentName] ?? {}),
            model,
            ...(provider ? { provider } : {}),
        };
        this.config = { ...this.config, agents };
        this.save();
    }

    /** Deep merge configurations */
    private mergeConfig(base: XQoderConfig, override: Partial<XQoderConfig>): XQoderConfig {
        return mergeXQoderConfig(base, override);
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
    const compactionAutoOverride = xqoderAutoCompact;

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

    const resolvedDefaultDeployTarget = defaultDeployTarget ?? baseConfig.defaultDeployTarget;
    const resolvedDebug = debugOverride ?? baseConfig.debug;

    // When the provider changes, the old provider's baseUrl must not bleed into
    // the new provider's config. Clear it so normalizeLLMConfig falls back to
    // getDefaultBaseUrlForProvider(newProvider). An explicit XQODER_LLM_BASE_URL
    // still wins because it is captured in llmOverrides.baseUrl.
    const providerChanged = provider !== undefined && provider !== baseConfig.llm.provider;
    const { baseUrl: _oldBaseUrl, ...baseLlmWithoutUrl } = baseConfig.llm;
    const baseLlmForMerge = (providerChanged && !env['XQODER_LLM_BASE_URL'])
        ? baseLlmWithoutUrl
        : baseConfig.llm;

    return {
        config: normalizeXQoderConfig({
            ...baseConfig,
            llm: normalizeLLMConfig({
                ...baseLlmForMerge,
                ...llmOverrides,
            }),
            providers: nextProviders,
            defaultAgent: baseDefaultAgent,
            agents: nextAgents,
            ...(resolvedDefaultDeployTarget !== undefined ? { defaultDeployTarget: resolvedDefaultDeployTarget } : {}),
            ...(resolvedDebug !== undefined ? { debug: resolvedDebug } : {}),
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
    const xqoderPath = path.join(homeDir, '.xqoder', 'config.json');
    if (fs.existsSync(xqoderPath)) {
        return xqoderPath;
    }

    return path.join(homeDir, '.xqoder.json');
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

    return path.join(configHome, 'xqoder', '.xqoder.json');
}

/** Global configuration manager instance */
export const configManager = new ConfigManager();
