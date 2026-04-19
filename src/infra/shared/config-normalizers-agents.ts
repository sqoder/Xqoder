import {
    type AgentSettings,
    type AgentSettingsMap,
    type LLMProviderName,
    type ProviderSettingsMap,
    type XQoderConfig,
} from './types.js';
import {
    normalizeInstructionList,
    normalizeOptionalNumber,
    withOptionalProp,
} from './config-normalizers-common.js';

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

export function normalizeAgentSettingsMap(settings: AgentSettingsMap | undefined): AgentSettingsMap {
    return Object.fromEntries(
        Object.entries(settings ?? {})
            .map(([name, value]) => [normalizeAgentName(name), normalizeAgentSettings(value)] as const)
            .filter(([name]) => Boolean(name)),
    );
}

export function mergeAgentSettingsMaps(
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

export function normalizeAgentSettings(settings: AgentSettings = {}): AgentSettings {
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

export function inferAgentProviders(
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

export function normalizeAgentName(value: string | undefined): string {
    return value?.trim() || '';
}
