import {
    buildLocalFallbackGuidance,
    isLikelyRemoteNetworkError,
    type LocalFallbackInput,
} from '../../../shared/local-fallback.js';
import {
    resolveProxyForProvider,
    type ProxyResolution,
    type ProxyResolutionOptions,
} from '../../../shared/network-proxy.js';

export type ApiKeySource = 'env' | 'config' | 'missing' | 'not-required';
export type ProviderReachability = 'reachable' | 'unreachable' | 'skipped';
export type ProviderFailureCategory = 'none' | 'missing_api_key' | 'network' | 'provider';

export interface ProviderProfile {
    provider: string;
    model: string;
    baseUrl?: string;
}

export interface ProviderProbeInput {
    profile: ProviderProfile;
    apiKey: string;
    env: NodeJS.ProcessEnv;
    proxy: ProxyResolution;
    timeoutMs: number;
}

export interface ProviderProbeResult {
    reachable: boolean;
    reason: string;
}

export type ProviderConnectivityProbe = (input: ProviderProbeInput) => Promise<ProviderProbeResult>;
export type ProviderFallbackAdvisor = (input: LocalFallbackInput) => Promise<string | undefined>;

export interface ProviderBootstrapInput {
    profile: ProviderProfile;
    apiKey: string;
    env?: NodeJS.ProcessEnv;
    systemProxyReader?: ProxyResolutionOptions['systemProxyReader'];
    connectivityProbe?: ProviderConnectivityProbe;
    fallbackAdvisor?: ProviderFallbackAdvisor;
    probeTimeoutMs?: number;
    missingApiKeyGuidance: string;
}

export interface ProviderBootstrapResult {
    profile: ProviderProfile;
    apiKeyRequired: boolean;
    apiKeySource: ApiKeySource;
    proxy: ProxyResolution;
    reachability: ProviderReachability;
    failureCategory: ProviderFailureCategory;
    message: string;
    fallbackGuidance?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1_200;

export async function evaluateProviderBootstrap(
    input: ProviderBootstrapInput,
): Promise<ProviderBootstrapResult> {
    const env = input.env ?? process.env;
    const profile = input.profile;
    const apiKeyRequired = providerRequiresApiKey(profile.provider);
    const apiKeyFromEnv = (env.XQODER_LLM_API_KEY ?? '').trim();
    const apiKeyFromConfig = input.apiKey.trim();
    const effectiveApiKey = apiKeyFromEnv || apiKeyFromConfig;
    const apiKeySource: ApiKeySource = apiKeyRequired
        ? apiKeyFromEnv
            ? 'env'
            : apiKeyFromConfig
                ? 'config'
                : 'missing'
        : 'not-required';
    const proxy = resolveProxyForProvider({
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        env,
        systemProxyReader: input.systemProxyReader,
    });

    if (apiKeySource === 'missing') {
        return {
            profile,
            apiKeyRequired,
            apiKeySource,
            proxy,
            reachability: 'skipped',
            failureCategory: 'missing_api_key',
            message: input.missingApiKeyGuidance,
        };
    }

    const probe = input.connectivityProbe;
    if (!probe) {
        return {
            profile,
            apiKeyRequired,
            apiKeySource,
            proxy,
            reachability: 'skipped',
            failureCategory: 'none',
            message: buildNetworkPathMessage(profile, proxy),
        };
    }

    try {
        const probeResult = await probe({
            profile,
            apiKey: effectiveApiKey,
            env,
            proxy,
            timeoutMs: input.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        });

        if (probeResult.reachable) {
            return {
                profile,
                apiKeyRequired,
                apiKeySource,
                proxy,
                reachability: 'reachable',
                failureCategory: 'none',
                message: buildNetworkPathMessage(profile, proxy),
            };
        }

        return {
            profile,
            apiKeyRequired,
            apiKeySource,
            proxy,
            reachability: 'unreachable',
            failureCategory: classifyFailureCategory(new Error(probeResult.reason)),
            message: probeResult.reason,
        };
    } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const failureCategory = classifyFailureCategory(normalizedError);
        const fallbackGuidance = failureCategory === 'network'
            ? await (input.fallbackAdvisor ?? buildLocalFallbackGuidance)({
                error: normalizedError,
                llmConfig: { provider: profile.provider },
                env,
            })
            : undefined;

        return {
            profile,
            apiKeyRequired,
            apiKeySource,
            proxy,
            reachability: 'unreachable',
            failureCategory,
            message: normalizedError.message,
            fallbackGuidance,
        };
    }
}

export async function probeProviderReachability(
    input: ProviderProbeInput,
): Promise<ProviderProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
        const response = await fetch(input.profile.baseUrl ?? defaultBaseUrl(input.profile.provider), {
            method: 'GET',
            headers: input.apiKey
                ? {
                    Authorization: `Bearer ${input.apiKey}`,
                }
                : undefined,
            signal: controller.signal,
        });

        return {
            reachable: true,
            reason: `Provider responded with HTTP ${response.status}`,
        };
    } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        return {
            reachable: false,
            reason: normalizedError.message,
        };
    } finally {
        clearTimeout(timer);
    }
}

function classifyFailureCategory(error: Error): ProviderFailureCategory {
    if (isLikelyRemoteNetworkError(error)) {
        return 'network';
    }
    return 'provider';
}

function providerRequiresApiKey(provider: string): boolean {
    return provider !== 'local';
}

function buildNetworkPathMessage(profile: ProviderProfile, proxy: ProxyResolution): string {
    if (proxy.proxyUrl) {
        return `Proxy ${proxy.source} will be used for ${profile.provider}: ${proxy.proxyUrl}`;
    }
    if (proxy.source === 'bypassed') {
        return proxy.reason;
    }
    return `Direct network will be used for ${profile.provider}. ${proxy.reason}`;
}

function defaultBaseUrl(provider: string): string {
    switch (provider) {
        case 'dashscope':
            return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        case 'groq':
            return 'https://api.groq.com/openai/v1';
        case 'openrouter':
            return 'https://openrouter.ai/api/v1';
        case 'gemini':
            return 'https://generativelanguage.googleapis.com/v1beta/openai';
        case 'xai':
            return 'https://api.x.ai/v1';
        case 'local':
            return 'http://localhost:11434/v1';
        default:
            return 'https://api.openai.com/v1';
    }
}
