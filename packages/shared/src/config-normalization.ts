import type {
    CompactionConfig,
    FormatterConfig,
    LSPServerConfig,
    LSPSettings,
    MCPServerConfig,
    MCPSettings,
    PluginPreferences,
    SandboxSettings,
    ShellConfig,
    TuiPreferences,
    WatcherConfig,
} from './config-types.js';

export const DEFAULT_CONTEXT_PATHS = [
    '.github/copilot-instructions.md',
    '.cursorrules',
    '.cursor/rules/',
    'CLAUDE.md',
    'CLAUDE.local.md',
    'opencode.md',
    'opencode.local.md',
    'OpenCode.md',
    'OpenCode.local.md',
    'OPENCODE.md',
    'OPENCODE.local.md',
];

const DEFAULT_TUI_PREFERENCES: TuiPreferences = {
    mouseMode: 'terminal',
    scrollStep: 3,
    inertiaDecayThreshold: 0.3,
    inertiaMaxStep: 20,
};

export function createDefaultShellConfig(env: NodeJS.ProcessEnv = process.env): ShellConfig {
    const shellPath = env['SHELL']?.trim() || '/bin/bash';
    return {
        path: shellPath,
        args: ['-l'],
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

export function normalizeTuiSettings(settings: Partial<TuiPreferences> | undefined): TuiPreferences {
    return {
        mouseMode: settings?.mouseMode === 'app' ? 'app' : DEFAULT_TUI_PREFERENCES.mouseMode,
        scrollStep: normalizeScrollStep(settings?.scrollStep),
        inertiaDecayThreshold: normalizeInertiaDecayThreshold(settings?.inertiaDecayThreshold),
        inertiaMaxStep: normalizeInertiaMaxStep(settings?.inertiaMaxStep),
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

export function normalizePluginPreferences(input: PluginPreferences | undefined): PluginPreferences {
    return {
        enabled: Array.isArray(input?.enabled) ? input.enabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        disabled: Array.isArray(input?.disabled) ? input.disabled.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        paths: Array.isArray(input?.paths) ? input.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
        allowIncompatible: input?.allowIncompatible ?? false,
    };
}

export function normalizeFormatterConfig(config: FormatterConfig | undefined): FormatterConfig | undefined {
    if (!config?.command?.trim()) {
        return undefined;
    }

    return {
        command: config.command.trim(),
        args: (config.args ?? []).map((value) => value.trim()).filter(Boolean),
        extensions: (config.extensions ?? []).map((value) => normalizeExtension(value)).filter(Boolean),
    };
}

export function normalizeWatcherConfig(config: WatcherConfig | undefined): WatcherConfig | undefined {
    if (!config?.ignore?.length) {
        return undefined;
    }

    return {
        ignore: config.ignore.map((value) => value.trim()).filter(Boolean),
    };
}

export function normalizeCompactionConfig(
    config: CompactionConfig | undefined,
    autoCompact: boolean | undefined,
): CompactionConfig | undefined {
    if (!config && autoCompact === undefined) {
        return undefined;
    }

    return {
        auto: autoCompact ?? config?.auto ?? true,
        prune: config?.prune ?? false,
        reserved: typeof config?.reserved === 'number' && Number.isFinite(config.reserved)
            ? Math.max(1, Math.trunc(config.reserved))
            : undefined,
    };
}

export function normalizeContextPaths(paths: string[] | undefined): string[] | undefined {
    if (!paths?.length) {
        return [...DEFAULT_CONTEXT_PATHS];
    }

    return paths.map((value) => value.trim()).filter(Boolean);
}

export function normalizeShellConfig(
    config: ShellConfig | undefined,
    env: NodeJS.ProcessEnv = process.env,
): ShellConfig | undefined {
    if (!config) {
        return createDefaultShellConfig(env);
    }

    const fallbackShell = createDefaultShellConfig(env);
    return {
        path: config.path?.trim() || fallbackShell.path,
        args: (config.args !== undefined ? config.args : fallbackShell.args ?? [])
            .map((value) => value.trim())
            .filter(Boolean),
    };
}

function normalizeMCPServerConfig(server: MCPServerConfig): MCPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const transport = server.transport === 'http' || server.transport === 'sse'
        ? server.transport
        : 'stdio';

    return {
        name: server.name?.trim() || '',
        transport,
        ...(server.command?.trim() ? { command: server.command.trim() } : {}),
        args: normalizedArgs,
        env: normalizedEnv,
        cwd: server.cwd?.trim() || undefined,
        ...(server.url?.trim() ? { url: server.url.trim() } : {}),
        ...(Object.keys(normalizedHeaders).length > 0 ? { headers: normalizedHeaders } : {}),
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
    };
}

function normalizeLSPServerConfig(server: LSPServerConfig): LSPServerConfig {
    const normalizedEnv = Object.fromEntries(
        Object.entries(server.env ?? {})
            .map(([key, value]) => [key.trim(), value])
            .filter(([key, value]) => key.length > 0 && typeof value === 'string'),
    );
    const normalizedArgs = (server.args ?? [])
        .map((value) => value.trim())
        .filter(Boolean);
    const normalizedExtensions = (server.extensions ?? [])
        .map((value) => normalizeExtension(value))
        .filter(Boolean);
    const normalizedBase = {
        name: server.name?.trim() || '',
        extensions: Array.from(new Set(normalizedExtensions)),
        languageId: server.languageId?.trim() || undefined,
        env: normalizedEnv,
        cwd: server.cwd?.trim() || undefined,
        enabled: server.enabled ?? true,
        timeoutMs: normalizeTimeout(server.timeoutMs),
        initializationOptions: server.initializationOptions ?? undefined,
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

function normalizeScrollStep(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 3;
    }
    return Math.max(1, Math.trunc(value));
}

function normalizeInertiaDecayThreshold(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0.3;
    }
    return Math.max(0.05, Math.min(5, value));
}

function normalizeInertiaMaxStep(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 20;
    }
    return Math.max(1, Math.min(100, Math.trunc(value)));
}

function normalizePort(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.trunc(value);
}

function normalizeExtension(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
        return '';
    }
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
}
