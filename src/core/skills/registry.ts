// P17 — Skill registry. Thin wrapper around `loadSkillsDir` that centralises
// the search roots and keeps a stable per-session snapshot. Kept
// intentionally small — we do not cache across sessions because skill files
// are edited by users between turns.

import * as os from 'node:os';
import * as path from 'node:path';
import { loadSkillsDir, type SkillFile } from './load-dir.js';

export interface SkillRegistry {
    readonly roots: readonly string[];
    readonly skills: readonly SkillFile[];
    get(name: string): SkillFile | undefined;
}

export interface LoadSkillRegistryOptions {
    /** Override the user-level home directory (used by tests). */
    readonly homeDir?: string;
    /** Extra roots to consider, inserted after project roots. */
    readonly extraRoots?: readonly string[];
}

export function resolveSkillSearchRoots(
    projectRoot: string,
    options: LoadSkillRegistryOptions = {},
): string[] {
    const home = options.homeDir ?? process.env.HOME ?? os.homedir();
    return [
        path.join(projectRoot, '.xqoder', 'skills'),
        path.join(projectRoot, '.claude', 'skills'),
        path.join(projectRoot, 'skills'),
        ...(options.extraRoots ?? []),
        path.join(home, '.xqoder', 'skills'),
        path.join(home, '.claude', 'skills'),
    ];
}

export function loadSkillRegistry(
    projectRoot: string,
    options: LoadSkillRegistryOptions = {},
): SkillRegistry {
    const roots = resolveSkillSearchRoots(projectRoot, options);
    const skills = loadSkillsDir(roots);
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    return {
        roots,
        skills,
        get(name) {
            return byName.get(name);
        },
    };
}
