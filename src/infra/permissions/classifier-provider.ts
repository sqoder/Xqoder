import { createLLMProvider } from '../../core/agent/llm/factory.js';
import type { ILLMProvider } from '../../shared/llm-api/base.js';
import type { ClassifierProviderFactory } from '../../domain/permissions/classifier/index.js';

/**
 * Default models for the two-stage yolo shell classifier.
 * Stage 1 uses a fast, cheap model (Haiku-class); stage 2 confirms with a
 * larger model only when stage 1 flagged the command.
 */
const STAGE1_MODEL = process.env['XQODER_CLASSIFIER_STAGE1_MODEL'] ?? 'claude-3-5-haiku-latest';
const STAGE2_MODEL = process.env['XQODER_CLASSIFIER_STAGE2_MODEL'] ?? 'claude-3-5-sonnet-latest';

/**
 * Cache providers across invocations so each call in a session reuses the same
 * HTTP client / token pool. This is scoped to the module, not per-session,
 * which matches the pattern used by `createLLMProvider` (stateless providers).
 */
const providerCache = new Map<string, ILLMProvider>();

async function getAnthropicProvider(model: string): Promise<ILLMProvider | undefined> {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) return undefined;

    const cached = providerCache.get(model);
    if (cached) return cached;

    const provider = await createLLMProvider({
        provider: 'anthropic',
        model,
        apiKey,
    });
    providerCache.set(model, provider);
    return provider;
}

/**
 * Creates a classifier provider factory for {@link decideShellPolicy}.
 *
 * The factory is synchronous (matches the sync surface `ClassifierProviderFactory`
 * expects) and returns `undefined` when the required API key is missing, in
 * which case the caller degrades to `ask` with `llm-unavailable`.
 */
export function createClassifierProviderFactory(): ClassifierProviderFactory {
    // Warm caches lazily on first call to avoid a surprise network hit during
    // startup; the factory itself stays sync.
    return (tier) => {
        const model = tier === 1 ? STAGE1_MODEL : STAGE2_MODEL;
        return providerCache.get(model);
    };
}

/**
 * Eager initializer that warms the cache up front. Call this from a place that
 * already awaits (e.g. when enabling the feature flag) so that the returned
 * factory hands back a provider synchronously afterwards.
 */
export async function warmClassifierProviderCache(): Promise<void> {
    await getAnthropicProvider(STAGE1_MODEL);
    await getAnthropicProvider(STAGE2_MODEL);
}

export function resetClassifierProviderCacheForTests(): void {
    providerCache.clear();
}

export function __setClassifierProviderForTests(tier: 1 | 2, provider: ILLMProvider): void {
    const model = tier === 1 ? STAGE1_MODEL : STAGE2_MODEL;
    providerCache.set(model, provider);
}
