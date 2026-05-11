// P17 — Skill loader.
//
// Scans a single directory (or ordered list of directories) for skill
// documents. Recognises two layouts:
//   1. `<dir>/<name>.md`                   — flat skill files
//   2. `<dir>/<name>/SKILL.md`             — skills bundled with resources
//
// Frontmatter is parsed by `./frontmatter.ts`. A skill without a
// `description` field is rejected — the SkillTool description dynamic
// listing relies on it, and a silent fallback would surface garbage to the
// model. Skills are deduplicated by name across roots (first root wins),
// matching the convention used by the markdown-agents loader.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { asString, asStringArray, parseSkillFrontmatter } from './frontmatter.js';

export interface SkillFile {
    readonly name: string;
    readonly description: string;
    readonly triggers: readonly string[];
    readonly tools: readonly string[];
    readonly filePath: string;
    readonly body: string;
}

export function loadSkillsDir(roots: string | readonly string[]): SkillFile[] {
    const rootList = typeof roots === 'string' ? [roots] : [...roots];
    const deduped = new Map<string, SkillFile>();

    for (const root of rootList) {
        for (const skill of readSkillsFromDir(root)) {
            if (!deduped.has(skill.name)) {
                deduped.set(skill.name, skill);
            }
        }
    }

    return Array.from(deduped.values())
        .sort((left, right) => left.name.localeCompare(right.name));
}

function readSkillsFromDir(root: string): SkillFile[] {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [];
    }

    const entries = fs.readdirSync(root, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    const skills: SkillFile[] = [];

    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
            const parsed = parseSkillAt(path.join(root, entry.name));
            if (parsed) skills.push(parsed);
            continue;
        }

        if (!entry.isDirectory()) continue;

        const skillMd = path.join(root, entry.name, 'SKILL.md');
        if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
            const parsed = parseSkillAt(skillMd, entry.name);
            if (parsed) skills.push(parsed);
        }
    }

    return skills;
}

function parseSkillAt(filePath: string, fallbackName?: string): SkillFile | undefined {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { metadata, body } = parseSkillFrontmatter(raw);

    const name = asString(metadata.name)
        ?? fallbackName
        ?? deriveNameFromPath(filePath);
    const description = asString(metadata.description);
    if (!name || !description) {
        return undefined;
    }

    const triggers = asStringArray(metadata.triggers);
    const tools = asStringArray(metadata.tools);

    return {
        name,
        description,
        triggers,
        tools,
        filePath,
        body: body.trimStart(),
    };
}

function deriveNameFromPath(filePath: string): string | undefined {
    const base = path.basename(filePath);
    if (base === 'SKILL.md') {
        return path.basename(path.dirname(filePath));
    }
    const stripped = base.replace(/\.md$/i, '');
    return stripped || undefined;
}
