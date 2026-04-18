import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigManager, configManager, resolveConfigWithEnvOverrides } from '@xqoder/shared';

export interface MemoryCommandOutputOptions {
    cwd?: string;
    json?: boolean;
    force?: boolean;
}

export interface MemoryCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface MemoryPaths {
    cwd: string;
    claudePath: string;
    legacyPath: string;
}

export interface MemorySnapshot extends MemoryPaths {
    claudeExists: boolean;
    legacyExists: boolean;
    activePath: string;
    activeExists: boolean;
    content: string;
    contextPaths: string[];
}

export interface MemoryWriteResult extends MemorySnapshot {
    action: 'init' | 'migrate';
    changed: boolean;
    migratedFromLegacy: boolean;
}

const DEFAULT_CLAUDE_MD = [
    '# Repository Instructions',
    '',
    '## Build / Test / Lint',
    '- Build: bun run build',
    '- Test: bun run test',
    '- Lint: bun run lint',
    '',
    '## Working Principles',
    '- Think before coding: state assumptions, expose tradeoffs, and stop when requirements are unclear.',
    '- Simplicity first: solve the requested problem with the minimum code that works.',
    '- Surgical changes: touch only the files and lines required for the task.',
    '- Goal-driven execution: define checks up front and verify after each meaningful change.',
    '',
    '## Notes',
    '- Keep changes minimal and scoped to the user request.',
    '- Prefer fixing root cause over a surface workaround.',
    '- Run targeted verification after code changes.',
    '',
].join('\n');

export function resolveMemoryPaths(cwd: string): MemoryPaths {
    const resolvedCwd = path.resolve(cwd);
    return {
        cwd: resolvedCwd,
        claudePath: path.join(resolvedCwd, 'CLAUDE.md'),
        legacyPath: path.join(resolvedCwd, 'XQoder.md'),
    };
}

export function createMemorySnapshot(
    options: MemoryCommandOutputOptions = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): MemorySnapshot {
    const paths = resolveMemoryPaths(options.cwd ?? process.cwd());
    const loaded = manager.load({ cwd: paths.cwd });
    const { config } = resolveConfigWithEnvOverrides(loaded);
    const claudeExists = fs.existsSync(paths.claudePath);
    const legacyExists = fs.existsSync(paths.legacyPath);
    const activePath = claudeExists ? paths.claudePath : paths.legacyPath;
    const activeExists = fs.existsSync(activePath);
    const content = activeExists ? fs.readFileSync(activePath, 'utf-8') : '';

    return {
        ...paths,
        claudeExists,
        legacyExists,
        activePath,
        activeExists,
        content,
        contextPaths: config.contextPaths ?? [],
    };
}

export function runShowMemoryCommand(
    options: MemoryCommandOutputOptions = {},
    dependencies: MemoryCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): MemorySnapshot {
    const snapshot = createMemorySnapshot(options, manager);

    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    const lines = [
        `cwd=${snapshot.cwd}`,
        `claude=${snapshot.claudePath} exists=${snapshot.claudeExists ? 'yes' : 'no'}`,
        `legacy=${snapshot.legacyPath} exists=${snapshot.legacyExists ? 'yes' : 'no'}`,
        `active=${snapshot.activePath} exists=${snapshot.activeExists ? 'yes' : 'no'}`,
        `contextPaths=${snapshot.contextPaths.join(', ') || '-'}`,
    ];

    if (snapshot.activeExists) {
        lines.push('---');
        lines.push(snapshot.content);
    } else {
        lines.push('No project instruction file found. Run `xqoder memory init` to create CLAUDE.md.');
    }

    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runMemoryPathCommand(
    options: MemoryCommandOutputOptions = {},
    dependencies: MemoryCommandDependencies = {},
): MemoryPaths {
    const paths = resolveMemoryPaths(options.cwd ?? process.cwd());

    if (options.json) {
        writeOutput(JSON.stringify(paths, null, 2), dependencies);
    } else {
        writeOutput(paths.claudePath, dependencies);
    }

    return paths;
}

export function runInitMemoryCommand(
    options: MemoryCommandOutputOptions = {},
    dependencies: MemoryCommandDependencies = {},
): MemoryWriteResult {
    const snapshot = createMemorySnapshot(options);

    if (snapshot.claudeExists && !options.force) {
        const unchanged: MemoryWriteResult = {
            ...snapshot,
            action: 'init',
            changed: false,
            migratedFromLegacy: false,
        };
        writeMemoryWriteResult(unchanged, options, dependencies);
        return unchanged;
    }

    const nextContent = snapshot.legacyExists
        ? fs.readFileSync(snapshot.legacyPath, 'utf-8')
        : DEFAULT_CLAUDE_MD;

    fs.writeFileSync(snapshot.claudePath, nextContent, 'utf-8');

    const result: MemoryWriteResult = {
        ...createMemorySnapshot(options),
        action: 'init',
        changed: true,
        migratedFromLegacy: snapshot.legacyExists,
    };
    writeMemoryWriteResult(result, options, dependencies);
    return result;
}

export function runMigrateMemoryCommand(
    options: MemoryCommandOutputOptions = {},
    dependencies: MemoryCommandDependencies = {},
): MemoryWriteResult {
    const snapshot = createMemorySnapshot(options);
    if (!snapshot.legacyExists) {
        const unchanged: MemoryWriteResult = {
            ...snapshot,
            action: 'migrate',
            changed: false,
            migratedFromLegacy: false,
        };
        writeMemoryWriteResult(unchanged, options, dependencies);
        return unchanged;
    }

    if (snapshot.claudeExists && !options.force) {
        const unchanged: MemoryWriteResult = {
            ...snapshot,
            action: 'migrate',
            changed: false,
            migratedFromLegacy: false,
        };
        writeMemoryWriteResult(unchanged, options, dependencies);
        return unchanged;
    }

    fs.writeFileSync(snapshot.claudePath, fs.readFileSync(snapshot.legacyPath, 'utf-8'), 'utf-8');

    const result: MemoryWriteResult = {
        ...createMemorySnapshot(options),
        action: 'migrate',
        changed: true,
        migratedFromLegacy: true,
    };
    writeMemoryWriteResult(result, options, dependencies);
    return result;
}

export function runMemoryCommand(fn: () => void): void {
    try {
        fn();
    } catch (error) {
        process.stderr.write(`memory command failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

function writeMemoryWriteResult(
    result: MemoryWriteResult,
    options: MemoryCommandOutputOptions,
    dependencies: MemoryCommandDependencies,
): void {
    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
        return;
    }

    const detail = result.changed
        ? `${result.action} completed path=${result.claudePath} migratedFromLegacy=${result.migratedFromLegacy ? 'yes' : 'no'}`
        : result.action === 'migrate'
            ? 'No migration performed.'
            : `CLAUDE.md already exists: ${result.claudePath}`;
    writeOutput(detail, dependencies);
}

function writeOutput(output: string, dependencies: MemoryCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
