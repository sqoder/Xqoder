import * as fs from 'node:fs';
import * as path from 'node:path';

export type NotepadSection = 'all' | 'priority' | 'working' | 'manual';

export interface NotepadOutputOptions {
    cwd?: string;
    dir?: string;
    json?: boolean;
    section?: NotepadSection;
    daysOld?: number;
}

export interface NotepadCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface NotepadPaths {
    cwd: string;
    notepadPath: string;
}

export interface NotepadSnapshot extends NotepadPaths {
    exists: boolean;
    content: string;
    sections: {
        priority: string;
        working: string;
        manual: string;
    };
    workingEntries: string[];
    manualEntries: string[];
}

export interface NotepadStats extends NotepadPaths {
    exists: boolean;
    size: number;
    priorityChars: number;
    workingEntryCount: number;
    manualEntryCount: number;
    oldestEntry: string | null;
    newestEntry: string | null;
}

export interface NotepadWriteResult extends NotepadSnapshot {
    action: 'write_priority' | 'write_working' | 'write_manual' | 'prune';
    changed: boolean;
    pruned?: number;
}

const DEFAULT_PRUNE_DAYS = 7;
const PRIORITY_CHAR_LIMIT = 500;

export function resolveNotepadPaths(cwd: string): NotepadPaths {
    const resolvedCwd = path.resolve(cwd);
    return {
        cwd: resolvedCwd,
        notepadPath: path.join(resolvedCwd, '.xqoder', 'notepad.md'),
    };
}

export function createNotepadSnapshot(
    options: NotepadOutputOptions = {},
): NotepadSnapshot {
    const paths = resolveNotepadPaths(resolveNotepadCwd(options));
    const exists = fs.existsSync(paths.notepadPath);
    const content = exists ? fs.readFileSync(paths.notepadPath, 'utf-8') : '';
    const sections = {
        priority: extractSection(content, 'PRIORITY'),
        working: extractSection(content, 'WORKING MEMORY'),
        manual: extractSection(content, 'MANUAL'),
    };

    return {
        ...paths,
        exists,
        content,
        sections,
        workingEntries: parseWorkingEntries(sections.working),
        manualEntries: sections.manual
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
    };
}

export function createNotepadStats(
    options: NotepadOutputOptions = {},
): NotepadStats {
    const snapshot = createNotepadSnapshot(options);
    const timestamps = snapshot.workingEntries
        .map((entry) => entry.match(/^\[(.+?)\]/)?.[1] ?? null)
        .filter((entry): entry is string => typeof entry === 'string');

    return {
        cwd: snapshot.cwd,
        notepadPath: snapshot.notepadPath,
        exists: snapshot.exists,
        size: snapshot.exists ? fs.statSync(snapshot.notepadPath).size : 0,
        priorityChars: snapshot.sections.priority.length,
        workingEntryCount: snapshot.workingEntries.length,
        manualEntryCount: snapshot.manualEntries.length,
        oldestEntry: timestamps[0] ?? null,
        newestEntry: timestamps[timestamps.length - 1] ?? null,
    };
}

export function runShowNotepadCommand(
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadSnapshot {
    const snapshot = createNotepadSnapshot(options);

    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    const selectedSection = options.section ?? 'all';
    const lines = [
        `cwd=${snapshot.cwd}`,
        `path=${snapshot.notepadPath}`,
        `exists=${snapshot.exists ? 'yes' : 'no'}`,
        `priorityChars=${snapshot.sections.priority.length}`,
        `workingEntries=${snapshot.workingEntries.length}`,
        `manualEntries=${snapshot.manualEntries.length}`,
    ];

    if (!snapshot.exists) {
        lines.push('No project notepad found. Use `xqoder notepad write-working "..."` or `/note ...` to create one.');
        writeOutput(lines.join('\n'), dependencies);
        return snapshot;
    }

    lines.push('---');
    lines.push(selectedSection === 'all'
        ? snapshot.content
        : getSectionContent(snapshot, selectedSection));
    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runNotepadPathCommand(
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadPaths {
    const paths = resolveNotepadPaths(resolveNotepadCwd(options));
    if (options.json) {
        writeOutput(JSON.stringify(paths, null, 2), dependencies);
    } else {
        writeOutput(paths.notepadPath, dependencies);
    }
    return paths;
}

export function runWritePriorityNotepadCommand(
    content: string,
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadWriteResult {
    const nextContent = content.trim();
    if (!nextContent) {
        throw new Error('Priority content cannot be empty');
    }

    const snapshot = createNotepadSnapshot(options);
    const updated = replaceSection(snapshot.content || createEmptyNotepad(), 'PRIORITY', nextContent.slice(0, PRIORITY_CHAR_LIMIT));
    writeNotepad(snapshot.notepadPath, updated);

    const result: NotepadWriteResult = {
        ...createNotepadSnapshot(options),
        action: 'write_priority',
        changed: true,
    };
    writeNotepadWriteResult(result, options, dependencies);
    return result;
}

export function runWriteWorkingNotepadCommand(
    content: string,
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadWriteResult {
    const nextContent = content.trim();
    if (!nextContent) {
        throw new Error('Working note content cannot be empty');
    }

    const snapshot = createNotepadSnapshot(options);
    const entry = `[${new Date().toISOString()}] ${nextContent}`;
    const updated = appendToSection(snapshot.content || createEmptyNotepad(), 'WORKING MEMORY', entry);
    writeNotepad(snapshot.notepadPath, updated);

    const result: NotepadWriteResult = {
        ...createNotepadSnapshot(options),
        action: 'write_working',
        changed: true,
    };
    writeNotepadWriteResult(result, options, dependencies);
    return result;
}

export function runWriteManualNotepadCommand(
    content: string,
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadWriteResult {
    const nextContent = content.trim();
    if (!nextContent) {
        throw new Error('Manual note content cannot be empty');
    }

    const snapshot = createNotepadSnapshot(options);
    const updated = appendToSection(snapshot.content || createEmptyNotepad(), 'MANUAL', nextContent);
    writeNotepad(snapshot.notepadPath, updated);

    const result: NotepadWriteResult = {
        ...createNotepadSnapshot(options),
        action: 'write_manual',
        changed: true,
    };
    writeNotepadWriteResult(result, options, dependencies);
    return result;
}

export function runPruneNotepadCommand(
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadWriteResult {
    const snapshot = createNotepadSnapshot(options);
    if (!snapshot.exists) {
        const result: NotepadWriteResult = {
            ...snapshot,
            action: 'prune',
            changed: false,
            pruned: 0,
        };
        writeNotepadWriteResult(result, options, dependencies);
        return result;
    }

    const daysOld = parseDaysOld(options.daysOld);
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const keptEntries = snapshot.workingEntries.filter((entry) => {
        const timestamp = entry.match(/^\[(.+?)\]/)?.[1];
        if (!timestamp) {
            return true;
        }
        return new Date(timestamp).getTime() >= cutoff;
    });
    const pruned = snapshot.workingEntries.length - keptEntries.length;
    const updated = replaceSection(snapshot.content, 'WORKING MEMORY', keptEntries.join('\n'));

    if (pruned > 0) {
        writeNotepad(snapshot.notepadPath, updated);
    }

    const result: NotepadWriteResult = {
        ...createNotepadSnapshot(options),
        action: 'prune',
        changed: pruned > 0,
        pruned,
    };
    writeNotepadWriteResult(result, options, dependencies);
    return result;
}

export function runNotepadStatsCommand(
    options: NotepadOutputOptions = {},
    dependencies: NotepadCommandDependencies = {},
): NotepadStats {
    const stats = createNotepadStats(options);
    if (options.json) {
        writeOutput(JSON.stringify(stats, null, 2), dependencies);
        return stats;
    }

    writeOutput([
        `cwd=${stats.cwd}`,
        `path=${stats.notepadPath}`,
        `exists=${stats.exists ? 'yes' : 'no'}`,
        `size=${stats.size}`,
        `priorityChars=${stats.priorityChars}`,
        `workingEntries=${stats.workingEntryCount}`,
        `manualEntries=${stats.manualEntryCount}`,
        `oldestEntry=${stats.oldestEntry ?? '-'}`,
        `newestEntry=${stats.newestEntry ?? '-'}`,
    ].join('\n'), dependencies);
    return stats;
}

export function buildProjectNotepadPromptAppendix(
    cwd: string,
    options: {
        workingEntryLimit?: number;
    } = {},
): string {
    const snapshot = createNotepadSnapshot({ cwd });
    if (!snapshot.exists) {
        return '';
    }

    const lines: string[] = [];
    if (snapshot.sections.priority) {
        lines.push('Project priority context:');
        lines.push(snapshot.sections.priority);
    }

    const workingLimit = options.workingEntryLimit ?? 3;
    const recentWorkingEntries = snapshot.workingEntries.slice(-workingLimit);
    if (recentWorkingEntries.length > 0) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push('Recent working notes:');
        lines.push(...recentWorkingEntries.map((entry) => `- ${entry}`));
    }

    if (lines.length === 0) {
        return '';
    }

    lines.push('');
    lines.push('Use this project context when relevant, but do not repeat it verbatim unless the user asks.');
    return lines.join('\n');
}

export function runNotepadCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        process.stderr.write(`notepad command failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

function resolveNotepadCwd(options: NotepadOutputOptions): string {
    return path.resolve(options.cwd ?? options.dir ?? process.cwd());
}

function getSectionContent(snapshot: NotepadSnapshot, section: NotepadSection): string {
    switch (section) {
        case 'priority':
            return snapshot.sections.priority;
        case 'working':
            return snapshot.sections.working;
        case 'manual':
            return snapshot.sections.manual;
        case 'all':
            return snapshot.content;
    }
}

function createEmptyNotepad(): string {
    return [
        '## PRIORITY',
        '',
        '## WORKING MEMORY',
        '',
        '## MANUAL',
        '',
    ].join('\n');
}

function parseWorkingEntries(sectionContent: string): string[] {
    return sectionContent
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function extractSection(content: string, section: 'PRIORITY' | 'WORKING MEMORY' | 'MANUAL'): string {
    const header = `## ${section}`;
    const index = content.indexOf(header);
    if (index < 0) {
        return '';
    }

    const nextHeader = content.indexOf('\n## ', index + header.length);
    return nextHeader < 0
        ? content.slice(index + header.length).trim()
        : content.slice(index + header.length, nextHeader).trim();
}

function replaceSection(content: string, section: 'PRIORITY' | 'WORKING MEMORY' | 'MANUAL', nextContent: string): string {
    const header = `## ${section}`;
    const source = content.trim() ? content : createEmptyNotepad();
    const index = source.indexOf(header);
    if (index < 0) {
        return `${source.trim()}\n\n${header}\n${nextContent}\n`;
    }

    const nextHeader = source.indexOf('\n## ', index + header.length);
    if (nextHeader < 0) {
        return `${source.slice(0, index)}${header}\n${nextContent}\n`;
    }

    return `${source.slice(0, index)}${header}\n${nextContent}\n${source.slice(nextHeader)}`;
}

function appendToSection(content: string, section: 'WORKING MEMORY' | 'MANUAL', entry: string): string {
    const existingSection = extractSection(content, section);
    const nextContent = existingSection
        ? `${existingSection}\n${entry}`
        : entry;
    return replaceSection(content, section, nextContent);
}

function parseDaysOld(value: number | undefined): number {
    if (value === undefined) {
        return DEFAULT_PRUNE_DAYS;
    }
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid prune age: ${value}`);
    }
    return value;
}

function writeNotepad(targetPath: string, content: string): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, targetPath);
}

function writeNotepadWriteResult(
    result: NotepadWriteResult,
    options: NotepadOutputOptions,
    dependencies: NotepadCommandDependencies,
): void {
    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
        return;
    }

    const baseLines = [
        `action=${result.action}`,
        `changed=${result.changed ? 'yes' : 'no'}`,
        `path=${result.notepadPath}`,
    ];

    if (result.action === 'prune') {
        baseLines.push(`pruned=${result.pruned ?? 0}`);
        baseLines.push(`remaining=${result.workingEntries.length}`);
    }

    writeOutput(baseLines.join('\n'), dependencies);
}

function writeOutput(output: string, dependencies: NotepadCommandDependencies): void {
    if (dependencies.writeOutput) {
        dependencies.writeOutput(output);
        return;
    }

    process.stdout.write(`${output}\n`);
}
