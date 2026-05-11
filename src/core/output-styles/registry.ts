// P17 — Output-style registry. Mirror of `skills/registry.ts`.

import * as os from 'node:os';
import * as path from 'node:path';
import { loadOutputStylesDir, type OutputStyleFile } from './load-dir.js';

export interface OutputStyleRegistry {
    readonly roots: readonly string[];
    readonly styles: readonly OutputStyleFile[];
    get(name: string): OutputStyleFile | undefined;
}

export interface LoadOutputStyleRegistryOptions {
    readonly homeDir?: string;
    readonly extraRoots?: readonly string[];
}

export function resolveOutputStyleSearchRoots(
    projectRoot: string,
    options: LoadOutputStyleRegistryOptions = {},
): string[] {
    const home = options.homeDir ?? process.env.HOME ?? os.homedir();
    return [
        path.join(projectRoot, '.xqoder', 'output-styles'),
        path.join(projectRoot, '.claude', 'output-styles'),
        path.join(projectRoot, 'output-styles'),
        ...(options.extraRoots ?? []),
        path.join(home, '.xqoder', 'output-styles'),
        path.join(home, '.claude', 'output-styles'),
    ];
}

export function loadOutputStyleRegistry(
    projectRoot: string,
    options: LoadOutputStyleRegistryOptions = {},
): OutputStyleRegistry {
    const roots = resolveOutputStyleSearchRoots(projectRoot, options);
    const styles = loadOutputStylesDir(roots);
    const byName = new Map(styles.map((style) => [style.name, style]));

    return {
        roots,
        styles,
        get(name) {
            return byName.get(name);
        },
    };
}
