import { lookup } from 'node:dns/promises';

export type UrlSafetyResult =
    | { allowed: true }
    | { allowed: false; reason: string };

export interface UrlSafetyOptions {
    allowHttp?: boolean;
    resolveIps?: (hostname: string) => Promise<string[]>;
}

export async function checkUrlSafety(
    rawUrl: string,
    options: UrlSafetyOptions,
): Promise<UrlSafetyResult> {
    if (!rawUrl) {
        return { allowed: false, reason: 'URL cannot be empty' };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { allowed: false, reason: `Malformed URL: ${rawUrl}` };
    }

    if (parsed.protocol === 'http:') {
        if (!options.allowHttp) {
            return { allowed: false, reason: 'http:// is blocked by default; use https:// or set allowHttp' };
        }
    } else if (parsed.protocol !== 'https:') {
        return { allowed: false, reason: `Protocol ${parsed.protocol} not allowed; only http/https` };
    }

    const host = parsed.hostname;
    if (!host) {
        return { allowed: false, reason: 'URL has no hostname' };
    }

    const literal = parseLiteralIp(host);
    if (literal) {
        const verdict = classifyIp(literal);
        if (verdict) {
            return { allowed: false, reason: verdict };
        }
        return { allowed: true };
    }

    const resolver = options.resolveIps ?? defaultResolver;
    const ips = await resolver(host).catch(() => [] as string[]);
    if (ips.length === 0) {
        return { allowed: false, reason: `DNS returned no addresses for ${host}` };
    }

    for (const ip of ips) {
        const verdict = classifyIp(ip);
        if (verdict) {
            return { allowed: false, reason: `${host} resolves to ${ip}: ${verdict}` };
        }
    }

    return { allowed: true };
}

async function defaultResolver(hostname: string): Promise<string[]> {
    const results = await lookup(hostname, { all: true });
    return results.map((r) => r.address);
}

function parseLiteralIp(host: string): string | null {
    if (host.startsWith('[') && host.endsWith(']')) {
        return host.slice(1, -1);
    }
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
        return host;
    }
    if (host.includes(':')) {
        return host;
    }
    return null;
}

function classifyIp(ip: string): string | null {
    if (ip.includes(':')) {
        return classifyIpv6(ip);
    }
    return classifyIpv4(ip);
}

function classifyIpv4(ip: string): string | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
        return `Invalid IPv4 address: ${ip}`;
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return 'loopback (127.0.0.0/8)';
    if (a === 0) return 'unspecified (0.0.0.0/8)';
    if (a === 10) return 'private RFC1918 (10.0.0.0/8)';
    if (a === 172 && b >= 16 && b <= 31) return 'private RFC1918 (172.16.0.0/12)';
    if (a === 192 && b === 168) return 'private RFC1918 (192.168.0.0/16)';
    if (a === 169 && b === 254) return 'link-local / metadata (169.254.0.0/16)';
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT (100.64.0.0/10)';
    if (a >= 224 && a <= 239) return 'multicast (224.0.0.0/4)';
    if (a >= 240) return 'reserved (240.0.0.0/4)';
    return null;
}

function classifyIpv6(ip: string): string | null {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return 'IPv6 loopback (::1)';
    if (normalized === '::') return 'IPv6 unspecified (::)';
    if (normalized.startsWith('::ffff:')) {
        const mapped = normalized.slice('::ffff:'.length);
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)) {
            return classifyIpv4(mapped);
        }
    }
    if (normalized.startsWith('fe80')) return 'IPv6 link-local (fe80::/10)';
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'IPv6 ULA (fc00::/7)';
    if (normalized.startsWith('ff')) return 'IPv6 multicast (ff00::/8)';
    return null;
}
