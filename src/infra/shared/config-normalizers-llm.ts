import {
    type AgentSettingsMap,
    type LLMInputModalities,
    type LLMModelReference,
    type LLMProviderConfig,
    type LLMProviderName,
    type ProviderSettingsMap,
    type XQoderConfig,
} from './types.js';
import { normalizeLLMConfig } from './llm.js';
import { withOptionalProp } from './config-normalizers-common.js';
import {
    normalizeAgentName,
    normalizeAgentSettingsMap,
    resolveDefaultAgentName,
} from './config-normalizers-agents.js';
import { normalizeProviderSettingsMap } from './config-normalizers-providers.js';

export function buildLLMConfigInput(
    provider: LLMProviderName,
    input: {
        model: string | undefined;
        apiKey: string | undefined;
        baseUrl: string | undefined;
        maxTokens: number | undefined;
        temperature: number | undefined;
        modalities?: LLMInputModalities;
    },
): Partial<Omit<LLMProviderConfig, 'provider'>> & Pick<LLMProviderConfig, 'provider'> {
    return {
        provider,
        ...withOptionalProp('model', input.model),
        ...withOptionalProp('apiKey', input.apiKey),
        ...withOptionalProp('baseUrl', input.baseUrl),
        ...withOptionalProp('maxTokens', input.maxTokens),
        ...withOptionalProp('temperature', input.temperature),
        ...withOptionalProp('modalities', input.modalities),
    };
}

export function normalizeModelReference(value: LLMModelReference | undefined): LLMModelReference | undefined {
    if (!value?.model?.trim()) {
        return undefined;
    }

    return {
        ...(value.provider !== undefined ? { provider: value.provider } : {}),
        model: value.model.trim(),
    };
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
            modalities: providerSettings.modalities ?? (config.llm.provider === provider ? config.llm.modalities : undefined),
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

export function resolveAgentLLMConfigFromState(
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
                    modalities: smallSettings.modalities,
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
            modalities: overrides.modalities
                ?? providerSettings.modalities
                ?? legacySameProvider?.modalities,
        },
    ));
}
