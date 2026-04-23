import { spawnSync } from 'node:child_process';

export type ProxySource = 'explicit-env' | 'env' | 'system' | 'none' | 'bypassed';
type ProxyProviderName = string;

export interface ProxyResolution {
    proxyUrl?: string;
    source: ProxySource;
    reason: string;
}

export interface ProxyResolutionOptions {
    provider: ProxyProviderName;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
    systemProxyReader?: () => string | undefined;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
let cachedMacOSSystemProxyUrl: string | null | undefined;

export function clearSystemProxyCacheForTests(): void {
    cachedMacOSSystemProxyUrl = undefined;
}

export function getEnvProxyUrl(env: NodeJS.ProcessEnv = process.env): ProxyResolution {
    const explicit = normalizeProxyUrl(env.XQODER_PROXY_URL);
    if (explicit) {
        return {
            proxyUrl: explicit,
            source: 'explicit-env',
            reason: 'XQODER_PROXY_URL is configured',
        };
    }

    const envProxy = normalizeProxyUrl(
        env.https_proxy
        ?? env.HTTPS_PROXY
        ?? env.http_proxy
        ?? env.HTTP_PROXY
        ?? env.all_proxy
        ?? env.ALL_PROXY,
    );

    if (envProxy) {
        return {
            proxyUrl: envProxy,
            source: 'env',
            reason: 'HTTP(S)_PROXY environment variable is configured',
        };
    }

    return {
        source: 'none',
        reason: 'No proxy environment variable configured',
    };
}

export function resolveProxyForProvider(options: ProxyResolutionOptions): ProxyResolution {
    const env = options.env ?? process.env;
    const requestUrl = options.baseUrl ?? defaultBaseUrlForProxyCheck(options.provider);

    if (options.provider === 'local' || isLocalUrl(requestUrl)) {
        return {
            source: 'bypassed',
            reason: `Proxy bypassed for local provider URL: ${requestUrl}`,
        };
    }

    const envProxy = getEnvProxyUrl(env);
    const proxyUrl = envProxy.proxyUrl
        ?? (isTruthy(env.XQODER_DISABLE_SYSTEM_PROXY)
            ? undefined
            : normalizeProxyUrl((options.systemProxyReader ?? readMacOSSystemProxyUrl)()));

    if (!proxyUrl) {
        return envProxy;
    }

    const source = envProxy.proxyUrl ? envProxy.source : 'system';
    if (shouldBypassProxy(requestUrl, env.NO_PROXY ?? env.no_proxy)) {
        return {
            source: 'bypassed',
            reason: `NO_PROXY bypasses ${new URL(requestUrl).hostname}`,
        };
    }

    return {
        proxyUrl,
        source,
        reason: source === 'system'
            ? 'macOS system proxy detected and auto-inherited'
            : envProxy.reason,
    };
}

export function readMacOSSystemProxyUrl(): string | undefined {
    if (cachedMacOSSystemProxyUrl !== undefined) {
        return cachedMacOSSystemProxyUrl ?? undefined;
    }

    if (process.platform !== 'darwin') {
        cachedMacOSSystemProxyUrl = null;
        return undefined;
    }

    const result = spawnSync('scutil', ['--proxy'], {
        encoding: 'utf-8',
        timeout: 1_000,
    });

    if (result.status !== 0 || !result.stdout) {
        cachedMacOSSystemProxyUrl = null;
        return undefined;
    }

    cachedMacOSSystemProxyUrl = parseMacOSProxyOutput(result.stdout) ?? null;
    return cachedMacOSSystemProxyUrl ?? undefined;
}

export function parseMacOSProxyOutput(output: string): string | undefined {
    const values = Object.fromEntries(
        output
            .split(/\r?\n/)
            .map((line) => /^\s*([^:]+)\s*:\s*(.*?)\s*$/.exec(line))
            .filter((match): match is RegExpExecArray => Boolean(match))
            .map((match) => [match[1]!.trim(), match[2]!.trim()]),
    );

    const httpsProxy = buildMacOSProxyUrl(values.HTTPSEnable, values.HTTPSProxy, values.HTTPSPort);
    if (httpsProxy) {
        return httpsProxy;
    }

    return buildMacOSProxyUrl(values.HTTPEnable, values.HTTPProxy, values.HTTPPort);
}

export function shouldBypassProxy(urlString: string, noProxy?: string): boolean {
    if (!noProxy?.trim()) {
        return false;
    }

    const normalized = noProxy.trim();
    if (normalized === '*') {
        return true;
    }

    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return false;
    }

    const hostname = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const hostWithPort = `${hostname}:${port}`;

    return normalized.split(/[\s,]+/).filter(Boolean).some((rawRule) => {
        const rule = rawRule.toLowerCase().trim();
        if (!rule) {
            return false;
        }
        if (rule.includes(':')) {
            return rule === hostWithPort;
        }
        if (rule.startsWith('*.')) {
            const suffix = rule.slice(1);
            return hostname.endsWith(suffix) || hostname === suffix.slice(1);
        }
        if (rule.startsWith('.')) {
            return hostname.endsWith(rule) || hostname === rule.slice(1);
        }
        return hostname === rule;
    });
}

export function isLocalUrl(urlString: string | undefined): boolean {
    if (!urlString) {
        return false;
    }

    try {
        const url = new URL(urlString);
        return LOCAL_HOSTS.has(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function defaultBaseUrlForProxyCheck(provider: ProxyProviderName): string {
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
            return DEFAULT_OPENAI_BASE_URL;
    }
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return undefined;
        }
        const normalized = url.toString();
        return url.pathname === '/' && !url.search && !url.hash
            ? normalized.replace(/\/$/, '')
            : normalized;
    } catch {
        return undefined;
    }
}

function buildMacOSProxyUrl(enabled: string | undefined, host: string | undefined, port: string | undefined): string | undefined {
    if (enabled !== '1' || !host?.trim() || !port?.trim()) {
        return undefined;
    }

    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort <= 0 || numericPort > 65535) {
        return undefined;
    }

    return `http://${host.trim()}:${numericPort}`;
}

function isTruthy(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}
