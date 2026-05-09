import * as fs from 'node:fs';
import * as os from 'node:os';
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
const MAX_IMPORT_DEPTH = 5;
// Path-shaped @-tokens that trigger an import expansion. A token is accepted
// when it starts with a clear path prefix (`./`, `../`, `/`, `~/`), or when
// it contains a `/` or a file extension in the middle segment. This avoids
// eating normal @mentions like `@username` or email fragments.
const IMPORT_TOKEN_PATTERN = /(?:^|(?<=[\s(]))@((?:\.{1,2}\/|\/|~\/)[^\s)"']+|[\w.-]+\/[^\s)"']+|[\w-]+\.[A-Za-z0-9]{1,8})(?=$|[\s).,;:"'])/g;

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
        const entry = readRuleFileEntry(absolutePath, cwd);
        if (entry) {
            resolvedEntries.push(entry);
        }
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
            const entry = readRuleFileEntry(absolutePath, cwd, `${renderedPrefix}/${file}`);
            if (entry) {
                output.push(entry);
            }
        }
    } catch {
        // ignore readdir errors
    }
}

function readRuleFileEntry(
    absolutePath: string,
    cwd: string,
    fallbackRelative?: string,
): string | undefined {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        return undefined;
    }
    const content = fs.readFileSync(absolutePath, 'utf-8').trim();
    if (!content) {
        return undefined;
    }

    const expanded = expandInstructionImports(content, absolutePath, cwd);
    const relativePath = path.relative(cwd, absolutePath)
        || fallbackRelative
        || path.basename(absolutePath);
    return `${relativePath}:\n${truncate(expanded, MAX_RULE_FILE_CHARS)}`;
}

/**
 * Expand @-path imports in an instruction file.
 *
 * Rules:
 * - Paths are resolved relative to the file that contains the token (not cwd).
 * - `@~/...` expands to the user's home directory.
 * - `@/abs/...` is absolute.
 * - Imports inside triple-backtick code fences are left untouched.
 * - Recursion follows imports up to MAX_IMPORT_DEPTH; cycles are broken via
 *   the visited-set passed through the chain.
 * - Missing or unreadable paths are silently left as plain text.
 * - Each imported file's content is trimmed; nothing is rewritten on disk.
 */
export function expandInstructionImports(
    content: string,
    sourceFilePath: string,
    cwd: string,
): string {
    return expandImportsRecursive(content, sourceFilePath, cwd, new Set(), 0);
}

function expandImportsRecursive(
    content: string,
    sourceFilePath: string,
    cwd: string,
    visited: ReadonlySet<string>,
    depth: number,
): string {
    if (depth >= MAX_IMPORT_DEPTH) {
        return content;
    }

    const lines = content.split('\n');
    const output: string[] = [];
    let insideFence = false;

    for (const line of lines) {
        // Toggle fenced code block. We only treat lines whose trimmed start
        // begins with triple backticks as fence boundaries; this matches the
        // common markdown convention without being over-clever.
        if (/^\s*```/.test(line)) {
            insideFence = !insideFence;
            output.push(line);
            continue;
        }

        if (insideFence) {
            output.push(line);
            continue;
        }

        const expandedLine = expandImportsInLine(line, sourceFilePath, cwd, visited, depth);
        output.push(expandedLine);
    }

    return output.join('\n');
}

function expandImportsInLine(
    line: string,
    sourceFilePath: string,
    cwd: string,
    visited: ReadonlySet<string>,
    depth: number,
): string {
    // Reset regex state per call since we use the global flag.
    IMPORT_TOKEN_PATTERN.lastIndex = 0;
    return line.replace(IMPORT_TOKEN_PATTERN, (match, captured: string) => {
        const targetPath = resolveImportTarget(captured, sourceFilePath);
        if (!targetPath) {
            return match;
        }
        if (visited.has(targetPath)) {
            return `[circular import skipped: ${captured}]`;
        }
        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
            return match;
        }

        let importedContent: string;
        try {
            importedContent = fs.readFileSync(targetPath, 'utf-8').trim();
        } catch {
            return match;
        }
        if (!importedContent) {
            return match;
        }

        const nextVisited = new Set(visited);
        nextVisited.add(targetPath);
        const expandedContent = expandImportsRecursive(
            importedContent,
            targetPath,
            cwd,
            nextVisited,
            depth + 1,
        );

        const relativeHeader = path.relative(cwd, targetPath) || path.basename(targetPath);
        return `\n<!-- imported from ${relativeHeader} -->\n${expandedContent}\n<!-- end import ${relativeHeader} -->\n`;
    });
}

function resolveImportTarget(captured: string, sourceFilePath: string): string | undefined {
    if (!captured) {
        return undefined;
    }

    // Home-directory expansion.
    if (captured === '~' || captured.startsWith('~/')) {
        return path.resolve(path.join(os.homedir(), captured.slice(captured === '~' ? 1 : 2)));
    }

    // Absolute path.
    if (captured.startsWith('/')) {
        return path.resolve(captured);
    }

    // Relative path — resolved against the directory of the file that
    // contains the import token.
    const sourceDir = path.dirname(sourceFilePath);
    return path.resolve(sourceDir, captured);
}
