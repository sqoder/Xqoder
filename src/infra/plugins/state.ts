// P18 — per-plugin enable/disable flag stored at
// ~/.xqoder/plugins/state.json. A plugin is enabled unless listed in
// `disabled`. The file is created lazily and corrupt state falls back to
// defaults so a bad write can never lock the user out of their plugins.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolvePluginsHome, type InstallerOptions } from './installer.js';

export interface PluginStateFile {
    readonly disabled: readonly string[];
}

const STATE_FILENAME = 'state.json';

function statePath(options: InstallerOptions): string {
    return path.join(resolvePluginsHome(options), STATE_FILENAME);
}

export function loadPluginState(options: InstallerOptions = {}): PluginStateFile {
    const file = statePath(options);
    if (!fs.existsSync(file)) return { disabled: [] };
    try {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { disabled?: unknown }).disabled)
        ) {
            const disabled = (parsed as { disabled: unknown[] }).disabled.filter(
                (value): value is string => typeof value === 'string',
            );
            return { disabled };
        }
    } catch {
        // fallthrough
    }
    return { disabled: [] };
}

export function savePluginState(state: PluginStateFile, options: InstallerOptions = {}): void {
    const file = statePath(options);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ disabled: state.disabled }, null, 2));
}

export function isPluginEnabled(name: string, options: InstallerOptions = {}): boolean {
    return !loadPluginState(options).disabled.includes(name);
}

export function setPluginEnabled(
    name: string,
    enabled: boolean,
    options: InstallerOptions = {},
): void {
    const state = loadPluginState(options);
    const set = new Set(state.disabled);
    if (enabled) set.delete(name);
    else set.add(name);
    savePluginState({ disabled: [...set].sort() }, options);
}
