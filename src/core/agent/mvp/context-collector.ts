import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AgentSession } from '../session/session.js';
import { classifyMvpTask, extractCandidatePaths } from './task-classifier.js';
import type { MvpCollectedContext, MvpProjectRule } from './types.js';

const DEFAULT_RULE_PATHS = [
    'CLAUDE.md',
    'CLAUDE.local.md',
    'XQoder.md',
    'xqoder.md',
    'xqoder.local.md',
];

export function collectMvpContext(input: {
    userGoal: string;
    projectRoot: string;
    contextPaths?: string[];
    session: AgentSession;
}): MvpCollectedContext {
    const taskType = classifyMvpTask(input.userGoal);
    const targetPaths = extractCandidatePaths(input.userGoal);

    return {
        userGoal: input.userGoal,
        taskType,
        targetPaths,
        relatedPaths: readRelatedPaths(input.projectRoot, targetPaths),
        projectRules: loadProjectRules(input.projectRoot, input.contextPaths),
        gitStatus: readGitStatus(input.projectRoot),
        gitDiffSnippets: readRelevantGitDiff(input.projectRoot, targetPaths),
        recentFileChanges: input.session.getFileChanges()
            .slice(-5)
            .map((entry) => `${entry.changeType} ${entry.path}`),
        recentCommands: input.session.getCommandHistory()
            .slice(-3)
            .map((entry) => `${entry.command} => ${entry.success ? 'ok' : 'failed'}`),
        recentToolSignals: input.session.getToolHistory()
            .slice(-4)
            .map((entry) => `${entry.name}: ${entry.outputPreview}`),
        recentSystemSignals: input.session.getMessages()
            .filter((message) => message.role === 'system' || message.role === 'tool')
            .slice(-6)
            .map((message) => `${message.role}: ${truncate(message.content, 220)}`),
    };
}

function loadProjectRules(projectRoot: string, configuredPaths: string[] | undefined): MvpProjectRule[] {
    const candidates = Array.from(new Set([
        ...(configuredPaths ?? []),
        ...DEFAULT_RULE_PATHS,
    ]));
    const resolvedRulePaths = new Set<string>();

    return candidates
        .map((candidate) => path.resolve(projectRoot, candidate))
        .filter((candidatePath) => fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile())
        .filter((candidatePath) => {
            const dedupeKey = getPathDeduplicationKey(candidatePath);
            if (resolvedRulePaths.has(dedupeKey)) {
                return false;
            }
            resolvedRulePaths.add(dedupeKey);
            return true;
        })
        .slice(0, 4)
        .map((candidatePath) => ({
            path: path.relative(projectRoot, candidatePath) || path.basename(candidatePath),
            content: truncate(fs.readFileSync(candidatePath, 'utf-8'), 1200),
        }));
}

function readGitStatus(projectRoot: string): string[] {
    const result = spawnSync('git', ['status', '--short', '--untracked-files=no'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 4000,
    });

    if (result.error || result.status !== 0) {
        return [];
    }

    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function readRelevantGitDiff(projectRoot: string, targetPaths: string[]): string[] {
    const result = spawnSync('git', ['diff', '--unified=1', '--', ...(targetPaths.length > 0 ? targetPaths : ['.'])], {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 4000,
    });

    if (result.error || result.status !== 0 || !result.stdout.trim()) {
        return [];
    }

    return splitDiffIntoSnippets(result.stdout)
        .slice(0, 3)
        .map((snippet) => truncate(snippet, 800));
}

function readRelatedPaths(projectRoot: string, targetPaths: string[]): string[] {
    const relatedPaths = new Set<string>();

    for (const targetPath of targetPaths) {
        const normalizedTargetPath = path.normalize(targetPath);
        const basename = path.basename(normalizedTargetPath, path.extname(normalizedTargetPath));
        if (!basename) {
            continue;
        }

        const result = spawnSync('rg', [
            '--files-with-matches',
            '--glob',
            '*.ts',
            '--glob',
            '*.tsx',
            '--glob',
            '*.js',
            '--glob',
            '*.jsx',
            '--glob',
            '*.mjs',
            '--glob',
            '*.cjs',
            basename,
            projectRoot,
        ], {
            cwd: projectRoot,
            encoding: 'utf-8',
            timeout: 4000,
        });

        if (result.error || (result.status !== 0 && result.status !== 1)) {
            collectRelatedPathsByScan(projectRoot, basename, normalizedTargetPath, relatedPaths);
            continue;
        }

        for (const line of result.stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const relativePath = path.relative(projectRoot, trimmed);
            if (!relativePath || relativePath === normalizedTargetPath) {
                continue;
            }

            relatedPaths.add(relativePath);
            if (relatedPaths.size >= 6) {
                return Array.from(relatedPaths);
            }
        }
    }

    return Array.from(relatedPaths);
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value.trim();
    }

    return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function splitDiffIntoSnippets(diffOutput: string): string[] {
    const trimmed = diffOutput.trim();
    if (!trimmed) {
        return [];
    }

    return trimmed
        .split(/^diff --git /m)
        .filter(Boolean)
        .map((chunk, index) => index === 0 && chunk.startsWith('a/')
            ? `diff --git ${chunk}`.trim()
            : `diff --git ${chunk}`.trim(),
        );
}

function collectRelatedPathsByScan(
    projectRoot: string,
    basename: string,
    normalizedTargetPath: string,
    relatedPaths: Set<string>,
): void {
    for (const filePath of listSearchableFiles(projectRoot)) {
        const relativePath = path.relative(projectRoot, filePath);
        if (!relativePath || path.normalize(relativePath) === normalizedTargetPath) {
            continue;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content.includes(basename)) {
                continue;
            }
            relatedPaths.add(relativePath);
            if (relatedPaths.size >= 6) {
                return;
            }
        } catch {
            continue;
        }
    }
}

function listSearchableFiles(rootDir: string): string[] {
    const pending = [rootDir];
    const files: string[] = [];
    const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
    const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);

    while (pending.length > 0) {
        const currentDir = pending.pop();
        if (!currentDir) {
            continue;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const absolutePath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name)) {
                    pending.push(absolutePath);
                }
                continue;
            }

            if (allowedExtensions.has(path.extname(entry.name))) {
                files.push(absolutePath);
            }
        }
    }

    return files;
}

function getPathDeduplicationKey(candidatePath: string): string {
    try {
        return fs.realpathSync.native(candidatePath).toLowerCase();
    } catch {
        return path.resolve(candidatePath).toLowerCase();
    }
}
