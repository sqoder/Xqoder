import {
    type LSPServerConfig,
    type LSPSettings,
    type MCPServerConfig,
    type MCPServerTrustLevel,
    type MCPSettings,
    type PluginPreferences,
    type SandboxSettings,
} from './types.js';
import { normalizeExtension } from './config-normalizers-common.js';

export function normalizePluginPreferences(input: PluginPreferences | undefined): PluginPreferences {
    return {
        enabled: Array.isArray(input?.enabled) ? input.enabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        disabled: Array.isArray(input?.disabled) ? input.disabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        paths: Array.isArray(input?.paths) ? input.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        allowIncompatible: input?.allowIncompatible ?? false,
    };
}

export function normalizeSandboxSettings(settings: Partial<SandboxSettings> = {}): SandboxSettings {
    return {
        mode: settings.mode ?? 'project',
        allowedPaths: (settings.allowedPaths ?? [])
            .map((value) => value.trim())
            .filter(Boolean),
    };
}

export function normalizeMCPSettings(settings: Partial<MCPSettings> | undefined): MCPSettings {
    return {
        servers: (settings?.servers ?? []).map((server) => normalizeMCPServerConfig(server)),
    };
}

export function normalizeLSPSettings(settings: Partial<LSPSettings> | undefined): LSPSettings {
    return {
        servers: (settings?.servers ?? []).map((server) => normalizeLSPServerConfig(server)),
    };
}

function normalizeMCPServerConfig(server: MCPServerConfig): MCPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value] as const)
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {})
            .map(([key, value]) => [key.trim(), value] as const)
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const transport = server.transport === 'http' || server.transport === 'sse'
        ? server.transport
        : 'stdio';
    const cwd = server.cwd?.trim() || undefined;

    return {
        name: server.name?.trim() || '',
        transport,
        ...(server.command?.trim() ? { command: server.command.trim() } : {}),
        args: normalizedArgs,
        env: normalizedEnv,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(server.url?.trim() ? { url: server.url.trim() } : {}),
        ...(Object.keys(normalizedHeaders).length > 0 ? { headers: normalizedHeaders } : {}),
        trust: normalizeMcpTrust(server.trust, transport),
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
    };
}

function normalizeLSPServerConfig(server: LSPServerConfig): LSPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value] as const)
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedExtensions = (server.extensions ?? [])
        .map((value) => normalizeExtension(value))
        .filter(Boolean);
    const languageId = server.languageId?.trim() || undefined;
    const cwd = server.cwd?.trim() || undefined;
    const initializationOptions = server.initializationOptions ?? undefined;
    const normalizedBase = {
        name: server.name?.trim() || '',
        extensions: Array.from(new Set(normalizedExtensions)),
        env: normalizedEnv,
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
        ...(languageId !== undefined ? { languageId } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(initializationOptions !== undefined ? { initializationOptions } : {}),
    };

    if (server.transport === 'tcp') {
        return {
            ...normalizedBase,
            transport: 'tcp',
            host: server.host?.trim() || '127.0.0.1',
            port: normalizePort(server.port),
            ...(server.command?.trim() ? { command: server.command.trim() } : {}),
            args: normalizedArgs,
        };
    }

    return {
        ...normalizedBase,
        transport: 'stdio',
        command: server.command?.trim() || '',
        args: normalizedArgs,
    };
}

function normalizeTimeout(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 15_000;
    }
    return Math.trunc(value);
}

function normalizeMcpTrust(
    value: MCPServerTrustLevel | undefined,
    transport: MCPServerConfig['transport'],
): MCPServerTrustLevel {
    if (value === 'trusted' || value === 'untrusted') {
        return value;
    }

    return transport === 'http' || transport === 'sse'
        ? 'untrusted'
        : 'trusted';
}

function normalizePort(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.trunc(value);
}
