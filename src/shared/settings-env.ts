import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function resolveSettingsPath(homeDir: string = os.homedir()): string {
    const override = process.env.XQODER_SETTINGS_PATH;
    if (override && override.trim()) {
        return override;
    }
    return path.join(homeDir, '.xqoder', 'config.json');
}

export function loadSettingsEnvFromFile(homeDir: string = os.homedir()): Record<string, string> {
    const settingsPath = resolveSettingsPath(homeDir);
    let raw: string;
    try {
        raw = fs.readFileSync(settingsPath, 'utf-8');
    } catch {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }
    const envField = (parsed as { env?: unknown }).env;
    if (!envField || typeof envField !== 'object' || Array.isArray(envField)) {
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(envField as Record<string, unknown>)) {
        if (typeof value === 'string') {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Merge a settings.env map into process.env. Existing keys win (process.env and command-line
 * overrides take precedence over config files).
 */
export function applySettingsEnv(envMap: Record<string, string>): void {
    for (const [key, value] of Object.entries(envMap)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
