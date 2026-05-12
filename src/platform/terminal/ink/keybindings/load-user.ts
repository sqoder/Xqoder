// P23a — load-user: load user keybinding overrides from ~/.xqoder/keybindings.json.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Keybinding } from './defaults.js';
import { DEFAULT_KEYBINDINGS } from './defaults.js';

const USER_KEYBINDINGS_PATH = path.join(os.homedir(), '.xqoder', 'keybindings.json');

/**
 * Load user keybinding overrides and merge with defaults.
 * User bindings override defaults by `id`. Unknown ids are appended.
 */
export function loadUserKeybindings(filePath = USER_KEYBINDINGS_PATH): Keybinding[] {
    let userBindings: Keybinding[] = [];

    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                userBindings = parsed.filter(isValidKeybinding);
            }
        }
    } catch {
        // Silently ignore parse errors — fall back to defaults
    }

    if (userBindings.length === 0) return DEFAULT_KEYBINDINGS;

    const merged = new Map<string, Keybinding>(
        DEFAULT_KEYBINDINGS.map((b) => [b.id, b]),
    );

    for (const binding of userBindings) {
        merged.set(binding.id, binding);
    }

    return Array.from(merged.values());
}

function isValidKeybinding(obj: unknown): obj is Keybinding {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof (obj as Record<string, unknown>)['id'] === 'string' &&
        Array.isArray((obj as Record<string, unknown>)['keys']) &&
        typeof (obj as Record<string, unknown>)['command'] === 'string'
    );
}
