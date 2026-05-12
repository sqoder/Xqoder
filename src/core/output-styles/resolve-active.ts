// P17 — Resolve the active output-style tail for a project.
//
// Reads the persisted selection, loads the registry, and returns the
// style file for appending (or undefined if nothing valid is selected).
// Silent on errors — output-style is advisory; a broken config should
// never block the turn.

import { readOutputStyleSelection } from './selection.js';
import { loadOutputStyleRegistry, type LoadOutputStyleRegistryOptions } from './registry.js';
import type { OutputStyleFile } from './load-dir.js';

export function resolveActiveOutputStyleTail(
    projectRoot: string,
    options: LoadOutputStyleRegistryOptions = {},
): OutputStyleFile | undefined {
    try {
        const selected = readOutputStyleSelection(projectRoot);
        if (!selected) return undefined;
        const registry = loadOutputStyleRegistry(projectRoot, options);
        return registry.get(selected);
    } catch {
        return undefined;
    }
}
