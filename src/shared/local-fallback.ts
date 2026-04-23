export interface LocalFallbackCandidate {
    provider: 'local';
    model: string;
    baseUrl: string;
}

export interface LocalFallbackLLMConfig {
    provider: string;
}

export interface LocalFallbackInput {
    error: Error;
    llmConfig: LocalFallbackLLMConfig;
    agentName?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
}

interface OllamaTagsResponse {
    models?: Array<{ name?: string; model?: string }>;
}

const NETWORK_ERROR_PATTERN = /(?:timed? out|timeout|fetch failed|failed to fetch|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|DNS|Resolving timed out|connection failed|network)/i;
const FALLBACK_GUIDANCE_MARKER = 'Suggested fallback: local/';
const PREFERRED_LOCAL_MODEL_PATTERNS = [/qwen3/i, /qwen2\.5/i, /gpt-oss/i, /gemma/i, /llama/i];

export function isLikelyRemoteNetworkError(error: Error): boolean {
    return NETWORK_ERROR_PATTERN.test(error.message);
}

export async function buildLocalFallbackGuidance(input: LocalFallbackInput): Promise<string | undefined> {
    if (
        input.llmConfig.provider === 'local'
        || input.error.message.includes(FALLBACK_GUIDANCE_MARKER)
        || !isLikelyRemoteNetworkError(input.error)
    ) {
        return undefined;
    }

    const candidate = await discoverLocalFallback(input.env, input.fetchImpl);
    if (!candidate) {
        return [
            'Remote provider failed before completion.',
            'No local Ollama fallback model was detected at http://localhost:11434.',
            'If you have Ollama installed, run `ollama list`, then switch with `xqoder models use <model> --provider local --agent general`.',
        ].join('\n');
    }

    const agent = input.agentName?.trim() || 'general';
    return [
        'Remote provider failed before completion, but a local Ollama fallback is available.',
        `Suggested fallback: ${candidate.provider}/${candidate.model}`,
        `Run: xqoder models use ${candidate.model} --provider local --agent ${agent}`,
        'Then retry the prompt or reopen TUI.',
    ].join('\n');
}

export async function discoverLocalFallback(
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl: typeof fetch = fetch,
): Promise<LocalFallbackCandidate | undefined> {
    const apiBaseUrl = (env.XQODER_LOCAL_OLLAMA_URL?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
    const endpoint = `${apiBaseUrl}/api/tags`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);

    try {
        const response = await fetchImpl(endpoint, { signal: controller.signal });
        if (!response.ok) {
            return undefined;
        }
        const payload = await response.json() as OllamaTagsResponse;
        const model = selectFallbackModel((payload.models ?? [])
            .map((entry) => entry.name ?? entry.model ?? '')
            .filter((name) => name.trim().length > 0));
        if (!model) {
            return undefined;
        }
        return {
            provider: 'local',
            model,
            baseUrl: `${apiBaseUrl}/v1`,
        };
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
}

export function selectFallbackModel(models: string[]): string | undefined {
    const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
    for (const pattern of PREFERRED_LOCAL_MODEL_PATTERNS) {
        const match = uniqueModels.find((model) => pattern.test(model));
        if (match) {
            return match;
        }
    }
    return uniqueModels[0];
}

export function providerSupportsLocalFallback(provider: string): boolean {
    return provider !== 'local';
}
