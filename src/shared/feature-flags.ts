// P10: runtime feature-flag registry (parity with openclaude's `bun:bundle::feature()`).
//
// Resolution order for `feature(name)`:
//   1. env var `XQODER_FEATURE_<NAME>` (1/true enables, 0/false disables)
//   2. persisted override in `~/.xqoder/features.json`
//   3. FEATURE_DEFAULTS below
//
// The cache is populated lazily on first read, or eagerly by `enableConfigs()`
// right after fast-path dispatch decides to load the main program.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applySettingsEnv, loadSettingsEnvFromFile } from './settings-env.js';

export const FEATURE_DEFAULTS = {
    HTTP_WITH_RETRY: true,
    ADVANCED_COMPACTION: true,
    PROMPT_CACHE: true,
    PERMISSION_MODE_V2: true,
    PERMISSION_YOLO_CLASSIFIER: false,
    OPENAI_SHIM: true,
    CODEX_SHIM: false,
    INK_REPL: true,
    DUMP_SYSTEM_PROMPT: true,
    COORDINATOR_MODE: false,
    CRON_TASKS: false,
    BRIDGE_MODE: false,
    DAEMON: false,
    BG_SESSIONS: false,
    WORKFLOW_SCRIPTS: false,
    MONITOR_TOOL: false,
    CHICAGO_MCP: false,
    TOKEN_BUDGET_ACTIVE: false,
} as const satisfies Record<string, boolean>;

export type KnownFeatureName = keyof typeof FEATURE_DEFAULTS;

export interface FeatureOverrideFile {
    readonly [feature: string]: boolean;
}

export interface FeatureOrigin {
    readonly name: string;
    readonly enabled: boolean;
    readonly default: boolean;
    readonly source: 'default' | 'file' | 'env';
}

let cache: FeatureOverrideFile | null = null;

function resolveFeaturesPath(homeDir: string = os.homedir()): string {
    const override = process.env.XQODER_FEATURES_PATH;
    if (override && override.trim()) {
        return override;
    }
    return path.join(homeDir, '.xqoder', 'features.json');
}

function parseEnvValue(value: string | undefined): boolean | undefined {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '1' || trimmed === 'true') {
        return true;
    }
    if (trimmed === '0' || trimmed === 'false') {
        return false;
    }
    return undefined;
}

function loadFeatureFile(homeDir: string = os.homedir()): FeatureOverrideFile {
    const featuresPath = resolveFeaturesPath(homeDir);
    try {
        const raw = fs.readFileSync(featuresPath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const result: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'boolean') {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

export function enableConfigs(homeDir: string = os.homedir()): void {
    cache = loadFeatureFile(homeDir);
    applySettingsEnv(loadSettingsEnvFromFile(homeDir));
}

export function resetFeatureCache(): void {
    cache = null;
}

export function feature(name: string): boolean {
    const envOverride = parseEnvValue(process.env[`XQODER_FEATURE_${name}`]);
    if (envOverride !== undefined) {
        return envOverride;
    }
    if (!cache) {
        cache = loadFeatureFile();
    }
    if (Object.prototype.hasOwnProperty.call(cache, name)) {
        return cache[name] ?? false;
    }
    if (Object.prototype.hasOwnProperty.call(FEATURE_DEFAULTS, name)) {
        return FEATURE_DEFAULTS[name as KnownFeatureName];
    }
    return false;
}

export function describeFeatures(homeDir: string = os.homedir()): FeatureOrigin[] {
    const fileCache = loadFeatureFile(homeDir);
    const names = new Set<string>([
        ...Object.keys(FEATURE_DEFAULTS),
        ...Object.keys(fileCache),
    ]);
    const sorted = Array.from(names).sort();
    return sorted.map((name) => {
        const defaultValue = (FEATURE_DEFAULTS as Record<string, boolean>)[name] ?? false;
        const envOverride = parseEnvValue(process.env[`XQODER_FEATURE_${name}`]);
        if (envOverride !== undefined) {
            return { name, enabled: envOverride, default: defaultValue, source: 'env' as const };
        }
        if (Object.prototype.hasOwnProperty.call(fileCache, name)) {
            return { name, enabled: fileCache[name] ?? false, default: defaultValue, source: 'file' as const };
        }
        return { name, enabled: defaultValue, default: defaultValue, source: 'default' as const };
    });
}

export function writeFeatureOverride(
    name: string,
    enabled: boolean,
    homeDir: string = os.homedir(),
): { featuresPath: string; written: FeatureOverrideFile } {
    const featuresPath = resolveFeaturesPath(homeDir);
    const existing = loadFeatureFile(homeDir);
    const next: Record<string, boolean> = { ...existing, [name]: enabled };
    fs.mkdirSync(path.dirname(featuresPath), { recursive: true });
    fs.writeFileSync(featuresPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    cache = next;
    return { featuresPath, written: next };
}

export function clearFeatureOverride(
    name: string,
    homeDir: string = os.homedir(),
): { featuresPath: string; written: FeatureOverrideFile } {
    const featuresPath = resolveFeaturesPath(homeDir);
    const existing = loadFeatureFile(homeDir);
    if (!Object.prototype.hasOwnProperty.call(existing, name)) {
        return { featuresPath, written: existing };
    }
    const next: Record<string, boolean> = { ...existing };
    delete next[name];
    fs.mkdirSync(path.dirname(featuresPath), { recursive: true });
    fs.writeFileSync(featuresPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    cache = next;
    return { featuresPath, written: next };
}

// Exported for tests — not part of the public runtime API.
export const __internal = {
    resolveFeaturesPath,
    loadFeatureFile,
    parseEnvValue,
};
