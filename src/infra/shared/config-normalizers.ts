// ============================================================
// XQoder Global Configuration Management
// ============================================================

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    type XQoderConfig,
    type ProviderSettings,
    type ProviderSettingsMap,
    type LLMProviderConfig,
    type LLMProviderName,
    type LLMModelReference,
    type AgentSettings,
    type AgentSettingsMap,
    type CommandTemplateSettings,
    type PermissionSettings,
    type HookHandlerConfig,
    type HookEventName,
    type HookMatcherConfig,
    type HooksSettings,
    type LSPServerConfig,
    type LSPSettings,
    type MCPServerConfig,
    type MCPSettings,
    type SandboxSettings,
    type TuiConfig,
    type FormatterConfig,
    type WatcherConfig,
    type CompactionConfig,
    type ShellConfig,
    type PluginPreferences,
    isHookEventName,
} from './types.js';
import { getDefaultModelForProvider, normalizeLLMConfig, SUPPORTED_LLM_PROVIDERS } from './llm.js';
import { getXQoderPaths } from './paths.js';
import {
    createDefaultConfig,
    DEFAULT_CONTEXT_PATHS,
} from './config-defaults.js';

/** Load tui.json configuration (XQoder style, separate from main config) */
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
            ...withOptionalProp('theme', parsed.theme),
            ...withOptionalProp('keybinds', parsed.keybinds),
            ...withOptionalProp('scroll_speed', parsed.scroll_speed),
            ...withOptionalProp('scroll_acceleration', parsed.scroll_acceleration),
            ...withOptionalProp('diff_style', parsed.diff_style),
        };
    } catch {
        return {};
    }
}

/** Write tui.json (merge existing), used for theme persistence etc. */
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

function withOptionalProp<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
    return value === undefined
        ? {}
        : { [key]: value } as Record<K, V>;
}

function buildLLMConfigInput(
    provider: LLMProviderName,
    input: {
        model: string | undefined;
        apiKey: string | undefined;
        baseUrl: string | undefined;
        maxTokens: number | undefined;
        temperature: number | undefined;
    },
): Partial<Omit<LLMProviderConfig, 'provider'>> & Pick<LLMProviderConfig, 'provider'> {
    return {
        provider,
        ...withOptionalProp('model', input.model),
        ...withOptionalProp('apiKey', input.apiKey),
        ...withOptionalProp('baseUrl', input.baseUrl),
        ...withOptionalProp('maxTokens', input.maxTokens),
        ...withOptionalProp('temperature', input.temperature),
    };
}

export function mergeXQoderConfig(base: XQoderConfig, override: Partial<XQoderConfig>): XQoderConfig {
    const mergedPluginPreferences = normalizePluginPreferences({
        ...(base.plugins ?? {}),
        ...(override.plugins ?? {}),
        ...withOptionalProp('enabled', override.plugins?.enabled ?? base.plugins?.enabled),
        ...withOptionalProp('disabled', override.plugins?.disabled ?? base.plugins?.disabled),
        ...withOptionalProp('paths', override.plugins?.paths ?? base.plugins?.paths),
    });

    return normalizeXQoderConfig({
        ...base,
        ...override,
        vercel: {
            ...(base.vercel ?? {}),
            ...(override.vercel ?? {}),
        },
        providers: mergeProviderSettingsMaps(base.providers, override.providers),
        ...withOptionalProp('defaultAgent', override.defaultAgent ?? base.defaultAgent),
        ...withOptionalProp('smallModel', override.smallModel ?? base.smallModel),
        agents: mergeAgentSettingsMaps(base.agents, override.agents),
        ...withOptionalProp('instructions', override.instructions ?? base.instructions),
        commands: {
            ...(base.commands ?? {}),
            ...(override.commands ?? {}),
        },
        permissions: {
            ...(base.permissions ?? {}),
            ...(override.permissions ?? {}),
            tools: {
                ...(base.permissions?.tools ?? {}),
                ...(override.permissions?.tools ?? {}),
            },
        },
        ...withOptionalProp('disableAllHooks', override.disableAllHooks ?? base.disableAllHooks),
        sandbox: normalizeSandboxSettings({
            ...(base.sandbox ?? {}),
            ...(override.sandbox ?? {}),
        }),
        hooks: mergeHooksSettings(base.hooks, override.hooks),
        mcp: normalizeMCPSettings(override.mcp ?? base.mcp),
        lsp: normalizeLSPSettings(override.lsp ?? base.lsp),
        plugins: mergedPluginPreferences,
    });
}

export function normalizeXQoderConfig(input: Partial<XQoderConfig>): XQoderConfig {
    const legacyLlm = normalizeLLMConfig(buildLLMConfigInput(
        input.llm?.provider ?? 'openai',
        {
            model: input.llm?.model,
            apiKey: input.llm?.apiKey,
            baseUrl: input.llm?.baseUrl,
            maxTokens: input.llm?.maxTokens,
            temperature: input.llm?.temperature,
        },
    ));
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
        ...withOptionalProp('smallModel', smallModel),
    });
    const theme = normalizeThemeName(input.theme) ?? compatibilityTheme;
    const disabledProviders = normalizeProviderList(input.disabledProviders);
    const enabledProviders = normalizeProviderList(input.enabledProviders);
    const formatter = normalizeFormatterConfig(input.formatter);
    const watcher = normalizeWatcherConfig(input.watcher);
    const compaction = normalizeCompactionConfig(input.compaction, readCompatibleAutoCompact(input));
    const contextPaths = normalizeContextPaths(input.contextPaths);
    const shell = normalizeShellConfig(input.shell);

    return {
        ...withOptionalProp('theme', theme),
        ...withOptionalProp('server', input.server),
        share: input.share ?? 'manual',
        autoupdate: input.autoupdate ?? true,
        ...withOptionalProp('keybinds', input.keybinds),
        llm: resolvedLlm,
        providers,
        ...withOptionalProp('disabledProviders', disabledProviders),
        ...withOptionalProp('enabledProviders', enabledProviders),
        defaultAgent,
        ...withOptionalProp('smallModel', smallModel),
        agents,
        instructions: normalizeInstructionList(input.instructions),
        commands: normalizeCommandTemplates(input.commands),
        permissions: normalizePermissionSettings(input.permissions),
        disableAllHooks: input.disableAllHooks ?? false,
        ...withOptionalProp('defaultDeployTarget', input.defaultDeployTarget),
        vercel: {
            ...(input.vercel ?? {}),
        },
        sandbox: normalizeSandboxSettings(input.sandbox),
        hooks: normalizeHooksSettings(input.hooks),
        mcp: normalizeMCPSettings(input.mcp),
        lsp: normalizeLSPSettings(input.lsp),
        recentProjects: normalizeRecentProjects(input.recentProjects),
        debug: input.debug ?? false,
        ...withOptionalProp('formatter', formatter),
        ...withOptionalProp('watcher', watcher),
        ...withOptionalProp('compaction', compaction),
        ...withOptionalProp('contextPaths', contextPaths),
        ...withOptionalProp('shell', shell),
        plugins: normalizePluginPreferences(input.plugins),
    };
}

function normalizePluginPreferences(input: PluginPreferences | undefined): PluginPreferences {
    return {
        enabled: Array.isArray(input?.enabled) ? input.enabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        disabled: Array.isArray(input?.disabled) ? input.disabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        paths: Array.isArray(input?.paths) ? input.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        allowIncompatible: input?.allowIncompatible ?? false,
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

    return normalizeLLMConfig(buildLLMConfigInput(
        provider,
        {
            model: reference.model,
            apiKey: providerSettings.apiKey ?? (config.llm.provider === provider ? config.llm.apiKey : ''),
            baseUrl: providerSettings.baseUrl ?? (config.llm.provider === provider ? config.llm.baseUrl : undefined),
            maxTokens: providerSettings.maxTokens ?? (config.llm.provider === provider ? config.llm.maxTokens : undefined),
            temperature: providerSettings.temperature ?? (config.llm.provider === provider ? config.llm.temperature : undefined),
        },
    ));
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
        ...withOptionalProp('smallModel', normalizeModelReference(config.smallModel)),
    }, agentName, overrides);
}

export function normalizeSandboxSettings(settings: Partial<SandboxSettings> = {}): SandboxSettings {
    return {
        mode: settings.mode ?? 'project',
        allowedPaths: (settings.allowedPaths ?? [])
            .map((value) => value.trim())
            .filter(Boolean),
    };
}

function normalizeMCPSettings(settings: Partial<MCPSettings> | undefined): MCPSettings {
    return {
        servers: (settings?.servers ?? []).map((server) => normalizeMCPServerConfig(server)),
    };
}

function normalizeLSPSettings(settings: Partial<LSPSettings> | undefined): LSPSettings {
    return {
        servers: (settings?.servers ?? []).map((server) => normalizeLSPServerConfig(server)),
    };
}

function normalizeMCPServerConfig(server: MCPServerConfig): MCPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const transport = server.transport === 'http' || server.transport === 'sse'
        ? server.transport
        : 'stdio';
    const cwd = server.cwd?.trim() || undefined;

    return {
        name: server.name?.trim() || '',
        transport,
        ...(server.command?.trim() ? { command: server.command.trim() } : {}),
        args: normalizedArgs,
        env: normalizedEnv,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(server.url?.trim() ? { url: server.url.trim() } : {}),
        ...(Object.keys(normalizedHeaders).length > 0 ? { headers: normalizedHeaders } : {}),
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
    };
}

function normalizeLSPServerConfig(server: LSPServerConfig): LSPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedExtensions = (server.extensions ?? [])
        .map((value) => normalizeExtension(value))
        .filter(Boolean);
    const languageId = server.languageId?.trim() || undefined;
    const cwd = server.cwd?.trim() || undefined;
    const initializationOptions = server.initializationOptions ?? undefined;
    const normalizedBase = {
        name: server.name?.trim() || '',
        extensions: Array.from(new Set(normalizedExtensions)),
        env: normalizedEnv,
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
        ...(languageId !== undefined ? { languageId } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(initializationOptions !== undefined ? { initializationOptions } : {}),
    };

    if (server.transport === 'tcp') {
        return {
            ...normalizedBase,
            transport: 'tcp',
            host: server.host?.trim() || '127.0.0.1',
            port: normalizePort(server.port),
            ...(server.command?.trim() ? { command: server.command.trim() } : {}),
            args: normalizedArgs,
        };
    }

    return {
        ...normalizedBase,
        transport: 'stdio',
        command: server.command?.trim() || '',
        args: normalizedArgs,
    };
}

function normalizeTimeout(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 15_000;
    }
    return Math.trunc(value);
}

function normalizePort(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.trunc(value);
}

function normalizeExtension(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        return '';
    }
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
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
        ...withOptionalProp('baseUrl', normalized[legacyLlm.provider]?.baseUrl ?? legacyLlm.baseUrl),
        ...withOptionalProp('maxTokens', normalized[legacyLlm.provider]?.maxTokens ?? legacyLlm.maxTokens),
        ...withOptionalProp('temperature', normalized[legacyLlm.provider]?.temperature ?? legacyLlm.temperature),
        disabled: normalized[legacyLlm.provider]?.disabled ?? false,
    });

    return normalized;
}

export function normalizeProviderSettings(
    provider: LLMProviderName,
    settings: ProviderSettings = {},
): ProviderSettings {
    const baseUrl = settings.baseUrl?.trim() || undefined;
    const maxTokens = normalizeOptionalNumber(settings.maxTokens);
    const temperature = normalizeOptionalNumber(settings.temperature);
    return {
        apiKey: settings.apiKey?.trim() || '',
        defaultModel: settings.defaultModel?.trim() || getDefaultModelForProvider(provider),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
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
    const model = settings.model?.trim() || undefined;
    const maxTokens = normalizeOptionalNumber(settings.maxTokens);
    const temperature = normalizeOptionalNumber(settings.temperature);
    const prompt = settings.prompt?.trim() || undefined;
    const cwd = settings.cwd?.trim() || undefined;
    return {
        ...withOptionalProp('mode', settings.mode),
        ...withOptionalProp('provider', settings.provider),
        ...withOptionalProp('model', model),
        ...withOptionalProp('maxTokens', maxTokens),
        ...withOptionalProp('temperature', temperature),
        ...withOptionalProp('prompt', prompt),
        instructions: normalizeInstructionList(settings.instructions),
        tools: (settings.tools ?? []).map((value) => value.trim()).filter(Boolean),
        ...(cwd !== undefined ? { cwd } : {}),
        ...withOptionalProp('permissionMode', settings.permissionMode),
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

        const description = template.description?.trim() || undefined;
        const agent = normalizeAgentName(template.agent) || undefined;
        templates[normalizedName] = {
            prompt,
            ...(description !== undefined ? { description } : {}),
            ...(agent !== undefined ? { agent } : {}),
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

function mergeHooksSettings(
    base: HooksSettings | undefined,
    override: HooksSettings | undefined,
): HooksSettings {
    const merged = normalizeHooksSettings(base);
    const normalizedOverride = normalizeHooksSettings(override);

    for (const eventName of Object.keys(normalizedOverride) as HookEventName[]) {
        const matcherGroups = normalizedOverride[eventName] ?? [];
        merged[eventName] = [
            ...(merged[eventName] ?? []),
            ...matcherGroups,
        ];
    }

    return merged;
}

function normalizeHooksSettings(settings: HooksSettings | undefined): HooksSettings {
    const entries: Array<[HookEventName, HookMatcherConfig[]]> = [];
    for (const [eventName, matcherGroups] of Object.entries(settings ?? {})) {
        const normalizedEventName = eventName.trim();
        const normalizedMatcherGroups = normalizeHookMatcherConfigs(matcherGroups);
        if (isHookEventName(normalizedEventName) && normalizedMatcherGroups.length > 0) {
            entries.push([normalizedEventName, normalizedMatcherGroups]);
        }
    }

    return Object.fromEntries(entries);
}

function normalizeHookMatcherConfigs(matcherGroups: HookMatcherConfig[] | undefined): HookMatcherConfig[] {
    const normalized: HookMatcherConfig[] = [];
    for (const matcherGroup of matcherGroups ?? []) {
        const hooks = normalizeHookHandlerConfigs(matcherGroup?.hooks);
        if (hooks.length === 0) {
            continue;
        }

        const matcher = matcherGroup?.matcher?.trim() || undefined;
        normalized.push({
            hooks,
            ...(matcher !== undefined ? { matcher } : {}),
        });
    }

    return normalized;
}

function normalizeHookHandlerConfigs(hooks: HookHandlerConfig[] | undefined): HookHandlerConfig[] {
    return (hooks ?? [])
        .map((hook) => normalizeHookHandlerConfig(hook))
        .filter((hook): hook is HookHandlerConfig => hook !== null);
}

function normalizeHookHandlerConfig(hook: HookHandlerConfig | undefined): HookHandlerConfig | null {
    if (!hook || typeof hook !== 'object') {
        return null;
    }

    const timeout = normalizeOptionalNumber(hook.timeout);
    switch (hook.type) {
        case 'command': {
            if (!hook.command?.trim()) {
                return null;
            }
            const shell = hook.shell?.trim() || undefined;
            return {
                type: 'command',
                command: hook.command.trim(),
                async: hook.async === true,
                ...(shell !== undefined ? { shell } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'http': {
            if (!hook.url?.trim()) {
                return null;
            }
            const headers = Object.fromEntries(
                Object.entries(hook.headers ?? {})
                    .map(([name, value]) => [name.trim(), value])
                    .filter(([name, value]) => name.length > 0 && typeof value === 'string' && value.trim().length > 0),
            );
            return {
                type: 'http',
                url: hook.url.trim(),
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'prompt': {
            if (!hook.prompt?.trim()) {
                return null;
            }
            const model = hook.model?.trim() || undefined;
            return {
                type: 'prompt',
                prompt: hook.prompt.trim(),
                ...(model !== undefined ? { model } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        case 'agent': {
            if (!hook.prompt?.trim()) {
                return null;
            }
            const agent = hook.agent?.trim() || undefined;
            const model = hook.model?.trim() || undefined;
            return {
                type: 'agent',
                prompt: hook.prompt.trim(),
                ...(agent !== undefined ? { agent } : {}),
                ...(model !== undefined ? { model } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
            };
        }
        default:
            return null;
    }
}

function normalizeRecentProjects(value: string[] | undefined): string[] {
    return Array.from(new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeModelReference(value: LLMModelReference | undefined): LLMModelReference | undefined {
    if (!value?.model?.trim()) {
        return undefined;
    }

    return {
        ...(value.provider !== undefined ? { provider: value.provider } : {}),
        model: value.model.trim(),
    };
}

export function normalizeAgentName(value: string | undefined): string {
    return value?.trim() || '';
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

export function resolveDefaultProviderName(
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
            return normalizeLLMConfig(buildLLMConfigInput(
                smallProvider,
                {
                    model: state.smallModel.model,
                    apiKey: smallSettings.apiKey ?? '',
                    baseUrl: smallSettings.baseUrl,
                    maxTokens: smallSettings.maxTokens,
                    temperature: smallSettings.temperature,
                },
            ));
        }
    }

    const providerSettings = state.providers[primaryProvider] ?? {};
    const legacySameProvider = state.llm.provider === primaryProvider ? state.llm : undefined;

    return normalizeLLMConfig(buildLLMConfigInput(
        primaryProvider,
        {
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
        },
    ));
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

function normalizeFormatterConfig(config: FormatterConfig | undefined): FormatterConfig | undefined {
    if (!config?.command?.trim()) {
        return undefined;
    }

    return {
        command: config.command.trim(),
        args: (config.args ?? []).map(a => a.trim()).filter(Boolean),
        extensions: (config.extensions ?? []).map(e => normalizeExtension(e)).filter(Boolean),
    };
}

function normalizeWatcherConfig(config: WatcherConfig | undefined): WatcherConfig | undefined {
    if (!config?.ignore?.length) {
        return undefined;
    }

    return {
        ignore: config.ignore.map(p => p.trim()).filter(Boolean),
    };
}

function normalizeCompactionConfig(
    config: CompactionConfig | undefined,
    autoCompact: boolean | undefined,
): CompactionConfig | undefined {
    if (!config && autoCompact === undefined) {
        return undefined;
    }

    const reserved = typeof config?.reserved === 'number' && Number.isFinite(config.reserved)
        ? Math.max(1, Math.trunc(config.reserved))
        : undefined;
    return {
        auto: autoCompact ?? config?.auto ?? true,
        prune: config?.prune ?? false,
        ...(reserved !== undefined ? { reserved } : {}),
    };
}

function normalizeContextPaths(paths: string[] | undefined): string[] | undefined {
    if (!paths?.length) {
        return [...DEFAULT_CONTEXT_PATHS];
    }

    return paths.map(p => p.trim()).filter(Boolean);
}

function normalizeShellConfig(config: ShellConfig | undefined): ShellConfig | undefined {
    if (!config) {
        return createDefaultConfig().shell;
    }

    const fallbackShell = createDefaultConfig().shell;
    const shellPath = config.path?.trim() || fallbackShell?.path;

    return {
        ...(shellPath !== undefined ? { path: shellPath } : {}),
        args: (config.args !== undefined ? config.args : fallbackShell?.args ?? []).map(a => a.trim()).filter(Boolean),
    };
}

export function normalizeLoadedConfigShape(input: Partial<XQoderConfig>): Partial<XQoderConfig> {
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
    const rawTui = (input as Partial<XQoderConfig> & { tui?: { theme?: string } }).tui;
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
