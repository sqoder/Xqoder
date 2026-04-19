import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    type CompactionConfig,
    type FormatterConfig,
    type ShellConfig,
    type TuiConfig,
    type WatcherConfig,
    type XQoderConfig,
} from './types.js';
import { createDefaultConfig, DEFAULT_CONTEXT_PATHS } from './config-defaults.js';
import { getXQoderPaths } from './paths.js';
import { normalizeExtension } from './config-normalizers-common.js';
import { normalizeAgentName } from './config-normalizers-agents.js';

/** Load tui.json configuration (XQoder style, separate from main config) */
export function loadTuiConfig(options?: {
    path?: string;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}): TuiConfig {
    const env = options?.env ?? process.env;
    const homeDir = options?.homeDir ?? os.homedir();
    const paths = getXQoderPaths(homeDir);
    const tuiPath = options?.path ?? env['XQODER_TUI_CONFIG'] ?? paths.tuiConfigFile;

    if (!fs.existsSync(tuiPath)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(tuiPath, 'utf-8');
        const parsed = JSON.parse(stripJsonComments(raw)) as Partial<TuiConfig>;
        return {
            ...(parsed.theme !== undefined ? { theme: parsed.theme } : {}),
            ...(parsed.keybinds !== undefined ? { keybinds: parsed.keybinds } : {}),
            ...(parsed.scroll_speed !== undefined ? { scroll_speed: parsed.scroll_speed } : {}),
            ...(parsed.scroll_acceleration !== undefined ? { scroll_acceleration: parsed.scroll_acceleration } : {}),
            ...(parsed.diff_style !== undefined ? { diff_style: parsed.diff_style } : {}),
        };
    } catch {
        return {};
    }
}

/** Write tui.json (merge existing), used for theme persistence etc. */
export function writeTuiConfig(updates: Partial<TuiConfig>, options?: { path?: string; homeDir?: string }): void {
    const homeDir = options?.homeDir ?? os.homedir();
    const paths = getXQoderPaths(homeDir);
    const tuiPath = options?.path ?? process.env['XQODER_TUI_CONFIG'] ?? paths.tuiConfigFile;
    const existing = loadTuiConfig({ path: tuiPath, homeDir });
    const merged: TuiConfig = {
        ...existing,
        ...updates,
    };
    const dir = path.dirname(tuiPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tuiPath, JSON.stringify(merged, null, 2), 'utf-8');
}

function stripJsonComments(raw: string): string {
    return raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim();
}

export function normalizeRecentProjects(value: string[] | undefined): string[] {
    return Array.from(new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

const VAR_PATTERN = /\{(env|file):([^}]+)\}/g;

/**
 * Substitute `{env:VAR_NAME}` and `{file:path}` placeholders in a string.
 * - `{env:VAR}` → value of environment variable VAR (empty string if not set)
 * - `{file:path}` → contents of the file at path (empty string if unreadable)
 */
export function substituteVars(input: string, env: NodeJS.ProcessEnv = process.env): string {
    return input.replace(VAR_PATTERN, (_match, type: string, ref: string) => {
        if (type === 'env') {
            return env[ref] ?? '';
        }
        if (type === 'file') {
            try {
                const resolved = ref.startsWith('~')
                    ? path.join(os.homedir(), ref.slice(1))
                    : ref;
                return fs.readFileSync(resolved, 'utf8').trim();
            } catch {
                return '';
            }
        }
        return '';
    });
}

/**
 * Recursively apply variable substitution to all string values in a config object.
 */
export function substituteConfigVars<T>(obj: T, env?: NodeJS.ProcessEnv): T {
    if (typeof obj === 'string') {
        return substituteVars(obj, env) as unknown as T;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => substituteConfigVars(item, env)) as unknown as T;
    }
    if (obj !== null && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            result[key] = substituteConfigVars(value, env);
        }
        return result as T;
    }
    return obj;
}

export function normalizeFormatterConfig(config: FormatterConfig | undefined): FormatterConfig | undefined {
    if (!config?.command?.trim()) {
        return undefined;
    }

    return {
        command: config.command.trim(),
        args: (config.args ?? []).map(a => a.trim()).filter(Boolean),
        extensions: (config.extensions ?? []).map(e => normalizeExtension(e)).filter(Boolean),
    };
}

export function normalizeWatcherConfig(config: WatcherConfig | undefined): WatcherConfig | undefined {
    if (!config?.ignore?.length) {
        return undefined;
    }

    return {
        ignore: config.ignore.map(p => p.trim()).filter(Boolean),
    };
}

export function normalizeCompactionConfig(
    config: CompactionConfig | undefined,
    autoCompact: boolean | undefined,
): CompactionConfig | undefined {
    if (!config && autoCompact === undefined) {
        return undefined;
    }

    const reserved = typeof config?.reserved === 'number' && Number.isFinite(config.reserved)
        ? Math.max(1, Math.trunc(config.reserved))
        : undefined;
    return {
        auto: autoCompact ?? config?.auto ?? true,
        prune: config?.prune ?? false,
        ...(reserved !== undefined ? { reserved } : {}),
    };
}

export function normalizeContextPaths(paths: string[] | undefined): string[] | undefined {
    if (!paths?.length) {
        return [...DEFAULT_CONTEXT_PATHS];
    }

    return paths.map(p => p.trim()).filter(Boolean);
}

export function normalizeShellConfig(config: ShellConfig | undefined): ShellConfig | undefined {
    if (!config) {
        return createDefaultConfig().shell;
    }

    const fallbackShell = createDefaultConfig().shell;
    const shellPath = config.path?.trim() || fallbackShell?.path;

    return {
        ...(shellPath !== undefined ? { path: shellPath } : {}),
        args: (config.args !== undefined ? config.args : fallbackShell?.args ?? []).map(a => a.trim()).filter(Boolean),
    };
}

export function normalizeLoadedConfigShape(input: Partial<XQoderConfig>): Partial<XQoderConfig> {
    const autoCompact = readCompatibleAutoCompact(input);
    const compatibilityTheme = readCompatibleTuiTheme(input);
    const inferredDefaultAgent = inferCompatibleDefaultAgent(input);

    return {
        ...input,
        ...(inferredDefaultAgent ? { defaultAgent: input.defaultAgent ?? inferredDefaultAgent } : {}),
        ...(compatibilityTheme ? { theme: input.theme ?? compatibilityTheme } : {}),
        ...(autoCompact !== undefined
            ? {
                compaction: {
                    ...(input.compaction ?? {}),
                    auto: autoCompact,
                },
            }
            : {}),
    };
}

export function readCompatibleTuiTheme(input: Partial<XQoderConfig>): string | undefined {
    const rawTui = (input as Partial<XQoderConfig> & { tui?: { theme?: string } }).tui;
    return normalizeThemeName(rawTui?.theme);
}

export function readCompatibleAutoCompact(input: Partial<XQoderConfig>): boolean | undefined {
    const compatibilityValue = (input as Partial<XQoderConfig> & { autoCompact?: boolean }).autoCompact;
    return typeof compatibilityValue === 'boolean'
        ? compatibilityValue
        : undefined;
}

export function normalizeThemeName(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function inferCompatibleDefaultAgent(input: Partial<XQoderConfig>): string | undefined {
    if (normalizeAgentName(input.defaultAgent)) {
        return undefined;
    }

    const agents = input.agents ?? {};
    const hasExplicitPrimaryAgent = Object.values(agents).some((agent) => agent?.mode === 'primary');
    if (hasExplicitPrimaryAgent) {
        return undefined;
    }

    return agents['coder'] ? 'coder' : undefined;
}
