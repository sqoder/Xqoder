import * as fs from 'node:fs';
import * as path from 'node:path';
import { createNotepadSnapshot } from '../system/notepad.js';

export type InstructionSourceName =
    | 'runtime_override'
    | 'project_config'
    | 'project_rules'
    | 'user_config'
    | 'working_memory';

export interface InstructionSource {
    name: InstructionSourceName;
    entries: string[];
}

export interface InstructionSourceInput {
    cwd?: string;
    runtimeOverrides?: string[];
    projectConfigInstructions?: string[];
    userConfigInstructions?: string[];
    projectRuleCandidates?: string[];
}

const DEFAULT_PROJECT_RULE_CANDIDATES = [
    'xqoder.md',
    'XQODER.md',
    'xqoder.local.md',
    'XQODER.local.md',
    'CLAUDE.md',
    'CLAUDE.local.md',
    '.claude/CLAUDE.md',
    '.claude/CLAUDE.local.md',
    'AGENTS.md',
];
const MAX_RULE_FILE_CHARS = 1_200;
const MAX_RULE_FILES = 3;

export function collectInstructionSources(input: InstructionSourceInput): InstructionSource[] {
    const sources: InstructionSource[] = [];

    addSource(sources, 'runtime_override', normalizeEntries(input.runtimeOverrides));
    addSource(sources, 'project_config', normalizeEntries(input.projectConfigInstructions));

    const projectRules = input.cwd ? readProjectRules(input.cwd, input.projectRuleCandidates) : [];
    addSource(sources, 'project_rules', projectRules);

    addSource(sources, 'user_config', normalizeEntries(input.userConfigInstructions));

    const workingMemory = input.cwd ? readWorkingMemory(input.cwd) : [];
    addSource(sources, 'working_memory', workingMemory);

    return sources;
}

function addSource(
    sources: InstructionSource[],
    name: InstructionSourceName,
    entries: string[],
): void {
    if (entries.length > 0) {
        sources.push({ name, entries });
    }
}

function normalizeEntries(entries: string[] | undefined): string[] {
    return (entries ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function readProjectRules(cwd: string, candidates: string[] | undefined): string[] {
    const seen = new Set<string>();
    const resolvedEntries: string[] = [];
    const ruleCandidates = candidates ?? DEFAULT_PROJECT_RULE_CANDIDATES;

    // 1. Root rule files
    for (const candidate of ruleCandidates) {
        const absolutePath = path.resolve(cwd, candidate);
        if (seen.has(absolutePath)) {
            continue;
        }
        seen.add(absolutePath);
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
            continue;
        }
        const content = fs.readFileSync(absolutePath, 'utf-8').trim();
        if (!content) {
            continue;
        }
        const relativePath = path.relative(cwd, absolutePath) || path.basename(absolutePath);
        resolvedEntries.push(`${relativePath}:\n${truncate(content, MAX_RULE_FILE_CHARS)}`);
    }

    collectRuleDirectoryEntries(cwd, path.resolve(cwd, '.xqoder', 'rules'), '.xqoder/rules', resolvedEntries);
    collectRuleDirectoryEntries(cwd, path.resolve(cwd, '.claude', 'rules'), '.claude/rules', resolvedEntries);

    return resolvedEntries.slice(0, MAX_RULE_FILES + 5); // Allow a few more for specific rules
}

function readWorkingMemory(cwd: string): string[] {
    const snapshot = createNotepadSnapshot({ cwd });
    if (!snapshot.exists) {
        return [];
    }

    const entries: string[] = [];
    const priority = snapshot.sections.priority.trim();
    if (priority) {
        entries.push(`Priority:\n${priority.slice(0, 500)}`);
    }

    if (snapshot.workingEntries.length > 0) {
        const latestEntries = snapshot.workingEntries.slice(-3).join('\n');
        entries.push(`Latest working memory:\n${latestEntries}`);
    }

    if (snapshot.manualEntries.length > 0) {
        entries.push(`Manual notes:\n${snapshot.manualEntries.slice(0, 5).join('\n')}`);
    }

    return entries;
}

function truncate(value: string, maxChars: number): string {
    return value.length > maxChars
        ? `${value.slice(0, maxChars)}...`
        : value;
}

function collectRuleDirectoryEntries(
    cwd: string,
    directory: string,
    renderedPrefix: string,
    output: string[],
): void {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        return;
    }

    try {
        const files = fs.readdirSync(directory)
            .filter((file) => file.endsWith('.md'))
            .sort((left, right) => left.localeCompare(right));
        for (const file of files) {
            const absolutePath = path.join(directory, file);
            const content = fs.readFileSync(absolutePath, 'utf-8').trim();
            if (!content) {
                continue;
            }
            const relativePath = path.relative(cwd, absolutePath) || `${renderedPrefix}/${file}`;
            output.push(`${relativePath}:\n${truncate(content, MAX_RULE_FILE_CHARS)}`);
        }
    } catch {
        // ignore readdir errors
    }
}
