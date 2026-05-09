// ============================================================
// XQoder Global Configuration Normalization Orchestration
// ============================================================

import {
    type XQoderConfig,
} from './types.js';
import { normalizeLLMConfig } from './llm.js';
import {
    normalizeCommandTemplates,
    normalizeInstructionList,
    normalizePermissionSettings,
    withOptionalProp,
} from './config-normalizers-common.js';
import {
    inferAgentProviders,
    mergeAgentSettingsMaps,
    normalizeAgentName,
    normalizeAgentSettingsMap,
    resolveDefaultAgentName,
} from './config-normalizers-agents.js';
import {
    buildLLMConfigInput,
    normalizeModelReference,
    resolveAgentLLMConfig,
    resolveAgentLLMConfigFromState,
    resolveDefaultProviderName,
    resolveSmallModelConfig,
} from './config-normalizers-llm.js';
import {
    mergeProviderSettingsMaps,
    normalizeProviderList,
    normalizeProviderSettings,
    normalizeProviderSettingsMap,
} from './config-normalizers-providers.js';
import {
    mergeHooksSettings,
    normalizeHooksSettings,
} from './config-normalizers-hooks.js';
import {
    normalizeLSPSettings,
    normalizeMCPSettings,
    normalizePluginPreferences,
    normalizeSandboxSettings,
} from './config-normalizers-integrations.js';
import {
    loadTuiConfig,
    normalizeCompactionConfig,
    normalizeContextPaths,
    normalizeFormatterConfig,
    normalizeLoadedConfigShape,
    normalizeRecentProjects,
    normalizeShellConfig,
    normalizeThemeName,
    normalizeWatcherConfig,
    readCompatibleAutoCompact,
    readCompatibleTuiTheme,
    substituteConfigVars,
    substituteVars,
    writeTuiConfig,
} from './config-normalizers-ui.js';

export {
    loadTuiConfig,
    normalizeAgentName,
    normalizeLoadedConfigShape,
    normalizeProviderSettings,
    normalizeSandboxSettings,
    resolveAgentLLMConfig,
    resolveDefaultAgentName,
    resolveDefaultProviderName,
    resolveSmallModelConfig,
    substituteConfigVars,
    substituteVars,
    writeTuiConfig,
};

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
            modalities: input.llm?.modalities,
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
