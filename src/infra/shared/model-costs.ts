// ============================================================
// Model Cost Metadata — Token pricing for each model
// ============================================================

export interface ModelCost {
    inputPer1M: number;
    outputPer1M: number;
    inputCachedPer1M?: number;
    outputCachedPer1M?: number;
    contextWindow?: number;
}

const MODEL_COSTS: Record<string, ModelCost> = {
    // OpenAI
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, inputCachedPer1M: 1.25, contextWindow: 128000 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, inputCachedPer1M: 0.075, contextWindow: 128000 },
    'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30, contextWindow: 128000 },
    'gpt-4': { inputPer1M: 30, outputPer1M: 60, contextWindow: 8192 },
    'gpt-3.5-turbo': { inputPer1M: 0.5, outputPer1M: 1.5, contextWindow: 16385 },
    'o1': { inputPer1M: 15, outputPer1M: 60, inputCachedPer1M: 7.5, contextWindow: 200000 },
    'o1-mini': { inputPer1M: 3, outputPer1M: 12, inputCachedPer1M: 1.5, contextWindow: 128000 },
    'o1-pro': { inputPer1M: 150, outputPer1M: 600, contextWindow: 200000 },
    'o3': { inputPer1M: 10, outputPer1M: 40, inputCachedPer1M: 2.5, contextWindow: 200000 },
    'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4, inputCachedPer1M: 0.55, contextWindow: 200000 },
    'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4, inputCachedPer1M: 0.275, contextWindow: 200000 },
    'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, inputCachedPer1M: 0.5, contextWindow: 1047576 },
    'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, inputCachedPer1M: 0.1, contextWindow: 1047576 },
    'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4, inputCachedPer1M: 0.025, contextWindow: 1047576 },

    // Anthropic
    'claude-sonnet-4-20250514': { inputPer1M: 3, outputPer1M: 15, inputCachedPer1M: 0.3, contextWindow: 200000 },
    'claude-3-7-sonnet-20250219': { inputPer1M: 3, outputPer1M: 15, inputCachedPer1M: 0.3, contextWindow: 200000 },
    'claude-3-5-sonnet-20241022': { inputPer1M: 3, outputPer1M: 15, inputCachedPer1M: 0.3, contextWindow: 200000 },
    'claude-3-5-sonnet-20240620': { inputPer1M: 3, outputPer1M: 15, contextWindow: 200000 },
    'claude-3-opus-20240229': { inputPer1M: 15, outputPer1M: 75, inputCachedPer1M: 1.5, contextWindow: 200000 },
    'claude-3-5-haiku-20241022': { inputPer1M: 0.8, outputPer1M: 4, inputCachedPer1M: 0.08, contextWindow: 200000 },

    // Google
    'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10, inputCachedPer1M: 0.31, contextWindow: 1048576 },
    'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6, inputCachedPer1M: 0.0375, contextWindow: 1048576 },
    'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4, inputCachedPer1M: 0.025, contextWindow: 1048576 },
    'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5, inputCachedPer1M: 0.3125, contextWindow: 2097152 },
    'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3, inputCachedPer1M: 0.01875, contextWindow: 1048576 },

    // Groq
    'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79, contextWindow: 128000 },
    'llama-3.1-8b-instant': { inputPer1M: 0.05, outputPer1M: 0.08, contextWindow: 128000 },

    // xAI
    'grok-3': { inputPer1M: 3, outputPer1M: 15, contextWindow: 131072 },
    'grok-3-mini': { inputPer1M: 0.3, outputPer1M: 0.5, contextWindow: 131072 },

    // DeepSeek
    'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28, inputCachedPer1M: 0.014, contextWindow: 64000 },
    'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19, inputCachedPer1M: 0.14, contextWindow: 64000 },

    // DashScope / Qwen
    'qwen-max': { inputPer1M: 2, outputPer1M: 6, contextWindow: 32768 },
    'qwen-plus': { inputPer1M: 0.8, outputPer1M: 2, contextWindow: 131072 },
    'qwen-turbo': { inputPer1M: 0.3, outputPer1M: 0.6, contextWindow: 131072 },
    'qwen-long': { inputPer1M: 0.5, outputPer1M: 2, contextWindow: 10000000 },
    'qwen3-235b-a22b': { inputPer1M: 4, outputPer1M: 16, contextWindow: 131072 },
    'qwen3-30b-a3b': { inputPer1M: 0.35, outputPer1M: 1.4, contextWindow: 131072 },

    // OpenRouter popular
    'anthropic/claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15, contextWindow: 200000 },
    'openai/gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, contextWindow: 128000 },
    'google/gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10, contextWindow: 1048576 },
};

/**
 * Look up cost for a model. Performs fuzzy matching: tries exact match first,
 * then prefix match, then substring match.
 */
export function getModelCost(model: string): ModelCost | undefined {
    const lower = model.toLowerCase();
    if (MODEL_COSTS[lower]) return MODEL_COSTS[lower];

    for (const [key, cost] of Object.entries(MODEL_COSTS)) {
        if (lower.startsWith(key) || key.startsWith(lower)) return cost;
    }

    for (const [key, cost] of Object.entries(MODEL_COSTS)) {
        if (lower.includes(key) || key.includes(lower)) return cost;
    }

    return undefined;
}

/**
 * Calculate cost from token usage.
 */
export function calculateCost(
    model: string,
    usage: { promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number },
): number {
    const cost = getModelCost(model);
    if (!cost) return 0;

    const cacheRead = usage.cacheReadTokens ?? 0;
    const regularInput = usage.promptTokens - cacheRead;

    let inputCost = (regularInput / 1_000_000) * cost.inputPer1M;
    if (cacheRead > 0 && cost.inputCachedPer1M) {
        inputCost += (cacheRead / 1_000_000) * cost.inputCachedPer1M;
    }
    const outputCost = (usage.completionTokens / 1_000_000) * cost.outputPer1M;

    return inputCost + outputCost;
}

/**
 * Get context window size for a model.
 */
export function getContextWindow(model: string): number | undefined {
    return getModelCost(model)?.contextWindow;
}

/**
 * Format cost as a string: "$0.0042"
 */
export function formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
}

/**
 * Format token count: "1.2K", "3.5M"
 */
export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
}
