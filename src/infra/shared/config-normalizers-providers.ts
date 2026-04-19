import {
    type LLMProviderConfig,
    type LLMProviderName,
    type ProviderSettings,
    type ProviderSettingsMap,
} from './types.js';
import { getDefaultModelForProvider, SUPPORTED_LLM_PROVIDERS } from './llm.js';
import { normalizeOptionalNumber, withOptionalProp } from './config-normalizers-common.js';

export function normalizeProviderSettingsMap(
    settings: ProviderSettingsMap | undefined,
    legacyLlm: LLMProviderConfig,
): ProviderSettingsMap {
    const normalized = Object.fromEntries(
        Object.entries(settings ?? {})
            .filter((entry): entry is [LLMProviderName, ProviderSettings] => SUPPORTED_LLM_PROVIDERS.includes(entry[0] as LLMProviderName))
            .map(([provider, value]) => [provider, normalizeProviderSettings(provider, value)]),
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

export function mergeProviderSettingsMaps(
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

export function normalizeProviderList(providers: LLMProviderName[] | undefined): LLMProviderName[] | undefined {
    if (!providers?.length) {
        return undefined;
    }

    return providers.filter(p => SUPPORTED_LLM_PROVIDERS.includes(p));
}
