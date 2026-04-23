import {
    evaluateProviderBootstrap,
    probeProviderReachability,
    type ProviderConnectivityProbe,
    type ProviderFallbackAdvisor,
} from './provider-bootstrap.js';
import type { ProxyResolutionOptions } from '../../shared/network-proxy.js';
import { MISSING_API_KEY_GUIDANCE } from './api-key-guidance.js';

export interface ProviderDoctorCheck {
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
}

export interface ProviderDoctorInput {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey: string;
    env?: NodeJS.ProcessEnv;
    systemProxyReader?: ProxyResolutionOptions['systemProxyReader'];
    connectivityProbe?: ProviderConnectivityProbe;
    fallbackAdvisor?: ProviderFallbackAdvisor;
}

export async function createProviderDoctorChecks(
    input: ProviderDoctorInput,
): Promise<ProviderDoctorCheck[]> {
    const bootstrap = await evaluateProviderBootstrap({
        profile: {
            provider: input.provider,
            model: input.model,
            baseUrl: input.baseUrl,
        },
        apiKey: input.apiKey,
        env: input.env,
        systemProxyReader: input.systemProxyReader,
        connectivityProbe: input.connectivityProbe,
        fallbackAdvisor: input.fallbackAdvisor,
        missingApiKeyGuidance: MISSING_API_KEY_GUIDANCE,
    });

    const keyMessage = bootstrap.apiKeySource === 'not-required'
        ? `Not required for provider: ${input.provider}`
        : bootstrap.apiKeySource === 'env'
            ? 'Configured (env)'
            : bootstrap.apiKeySource === 'config'
                ? 'Configured (config)'
                : bootstrap.message;

    const keyStatus: ProviderDoctorCheck['status'] = bootstrap.apiKeySource === 'missing' ? 'error' : 'ok';

    const networkStatus: ProviderDoctorCheck['status'] = bootstrap.reachability === 'unreachable'
        ? 'warn'
        : 'ok';
    const networkMessage = bootstrap.fallbackGuidance
        ? `${bootstrap.message}\n${bootstrap.fallbackGuidance}`
        : bootstrap.message;

    return [
        {
            name: 'LLM API key',
            status: keyStatus,
            message: keyMessage,
        },
        {
            name: 'Provider network',
            status: networkStatus,
            message: networkMessage,
        },
    ];
}

export { probeProviderReachability };
