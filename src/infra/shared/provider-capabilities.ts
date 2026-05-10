import type { LLMInputModalities, LLMProviderConfig, LLMProviderName } from './types.js';

export type ResolvedLLMInputModalities = Required<LLMInputModalities>;

export interface LLMProviderCapabilities {
    readonly provider: LLMProviderName;
    readonly model: string;
    readonly input: ResolvedLLMInputModalities;
    readonly nativePdf: boolean;
    readonly openAIFileDataFormat: 'base64' | 'data-url';
    readonly supportsStrictTools: boolean;
}

const TEXT_ONLY: ResolvedLLMInputModalities = {
    image: false,
    pdf: false,
    audio: false,
    video: false,
};

const FULL_MULTIMODAL: ResolvedLLMInputModalities = {
    image: true,
    pdf: true,
    audio: true,
    video: true,
};

const MODEL_MODALITY_PATTERNS: Array<[RegExp, LLMInputModalities]> = [
    [/^gemini-/, FULL_MULTIMODAL],
    [/^claude-/, { image: true, pdf: true }],
    [/^gpt-(?:4o|4\.1|4\.5|5)(?:[.-]|$)/, { image: true, pdf: true }],
    [/^o\d(?:-|$)/, { image: true, pdf: true }],
    [/^grok-(?:2-vision|4)/, { image: true }],
    [/^qwen3?[-.]omni/, { image: true, audio: true, video: true }],
    [/^qwen3?[.-](?:5|6)-(?:plus|flash)/, { image: true, video: true }],
    [/^qwen-vl-/, { image: true, video: true }],
    [/^qwen3-vl-/, { image: true, video: true }],
    [/^qvq-/, { image: true, video: true }],
    [/^llava/, { image: true }],
];

const OPENAI_CHAT_FILE_PROVIDERS = new Set<LLMProviderName>([
    'openai',
    'azure',
    'dashscope',
    'openai-compatible',
    'openrouter',
]);

export function resolveLLMProviderCapabilities(config: LLMProviderConfig): LLMProviderCapabilities {
    const inferred = inferInputModalities(config.provider, config.model);
    const input = normalizeInputModalities({
        ...inferred,
        ...(config.modalities ?? {}),
    });

    return {
        provider: config.provider,
        model: config.model,
        input,
        nativePdf: supportsNativePdf(config, input),
        openAIFileDataFormat: openAIFileDataFormat(config.provider),
        supportsStrictTools: supportsStrictTools(config.provider),
    };
}

const STRICT_TOOLS_PROVIDERS = new Set<LLMProviderName>([
    'openai',
    'azure',
    'openai-compatible',
    'openrouter',
    'xai',
    'groq',
]);

function supportsStrictTools(provider: LLMProviderName): boolean {
    return STRICT_TOOLS_PROVIDERS.has(provider);
}

export function normalizeInputModalities(input: LLMInputModalities | undefined): ResolvedLLMInputModalities {
    return {
        image: input?.image === true,
        pdf: input?.pdf === true,
        audio: input?.audio === true,
        video: input?.video === true,
    };
}

export function normalizeOptionalInputModalities(input: LLMInputModalities | undefined): LLMInputModalities | undefined {
    if (!input) {
        return undefined;
    }

    const normalized: LLMInputModalities = {};
    for (const key of ['image', 'pdf', 'audio', 'video'] as const) {
        if (typeof input[key] === 'boolean') {
            normalized[key] = input[key];
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function inferInputModalities(provider: LLMProviderName, model: string): LLMInputModalities {
    if (provider === 'anthropic' || provider === 'bedrock') {
        return { image: true, pdf: true };
    }

    if (provider === 'gemini' || provider === 'vertexai') {
        return FULL_MULTIMODAL;
    }

    const candidates = normalizedModelCandidates(model);
    for (const [pattern, modalities] of MODEL_MODALITY_PATTERNS) {
        if (candidates.some((candidate) => pattern.test(candidate))) {
            return modalities;
        }
    }

    return TEXT_ONLY;
}

function supportsNativePdf(config: LLMProviderConfig, input: ResolvedLLMInputModalities): boolean {
    if (!input.pdf) {
        return false;
    }

    if (config.provider === 'anthropic' || config.provider === 'bedrock') {
        return true;
    }

    if (OPENAI_CHAT_FILE_PROVIDERS.has(config.provider)) {
        return true;
    }

    if ((config.provider === 'gemini' || config.provider === 'vertexai') && config.modalities?.pdf === true) {
        return true;
    }

    return false;
}

function openAIFileDataFormat(provider: LLMProviderName): 'base64' | 'data-url' {
    return provider === 'dashscope' || provider === 'openrouter' || provider === 'openai-compatible'
        ? 'data-url'
        : 'base64';
}

function normalizedModelCandidates(model: string): string[] {
    const normalized = model.trim().toLowerCase().replace(/^models\//, '');
    if (!normalized) {
        return [];
    }

    const leaf = normalized.split('/').filter(Boolean).at(-1);
    return leaf && leaf !== normalized ? [normalized, leaf] : [normalized];
}
