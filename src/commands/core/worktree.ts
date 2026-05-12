// P19c — `xqoder worktree` CLI group.
//
// Mirrors the shape of `xqoder task` / `xqoder cron` so the same --json flag
// conventions apply. Wraps the worktree-manager git operations directly.

import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import {
    addWorktree,
    countWorktreeChanges,
    findGitRoot,
    generateWorktreeSlug,
    getCurrentBranch,
    listWorktrees,
    removeWorktree,
    validateWorktreeSlug,
} from '@xqoder/core-worktree';

export interface WorktreeCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
}

interface JsonOption {
    json?: boolean;
}

interface EnterOptions extends JsonOption {
    name?: string;
    baseRef?: string;
}

interface RemoveOptions extends JsonOption {
    force?: boolean;
}

function resolveDeps(deps: WorktreeCommandDependencies) {
    return {
        cwd: deps.cwd ?? process.cwd(),
        writeOutput: deps.writeOutput ?? ((line: string) => process.stdout.write(line + '\n')),
    };
}

function runSafely(fn: () => Promise<void>): void {
    fn().catch((err: unknown) => {
        logger.error('worktree command failed', { error: err });
        process.exit(1);
    });
}

// ---------------------------------------------------------------------------
// Exported runners (testable without Commander)
// ---------------------------------------------------------------------------

export async function runEnter(
    options: EnterOptions,
    deps: WorktreeCommandDependencies,
): Promise<void> {
    const { cwd, writeOutput } = resolveDeps(deps);

    const slug = options.name?.trim() || generateWorktreeSlug();
    validateWorktreeSlug(slug);

    const gitRoot = await findGitRoot(cwd);
    if (!gitRoot) throw new Error(`Not inside a git repository: ${cwd}`);

    const baseRef = options.baseRef?.trim() || 'HEAD';
    const result = await addWorktree(gitRoot, slug, baseRef);

    if (options.json) {
        writeOutput(JSON.stringify({ slug, ...result }, null, 2));
    } else {
        writeOutput(`Worktree created: ${result.worktreePath}`);
        writeOutput(`Branch: ${result.worktreeBranch}`);
        writeOutput(`cd ${result.worktreePath}`);
    }
}

export async function runList(
    options: JsonOption,
    deps: WorktreeCommandDependencies,
): Promise<void> {
    const { cwd, writeOutput } = resolveDeps(deps);

    const gitRoot = await findGitRoot(cwd);
    if (!gitRoot) throw new Error(`Not inside a git repository: ${cwd}`);

    const worktrees = await listWorktrees(gitRoot);

    if (options.json) {
        writeOutput(JSON.stringify(worktrees, null, 2));
    } else {
        if (worktrees.length === 0) {
            writeOutput('No worktrees found.');
            return;
        }
        for (const wt of worktrees) {
            const tag = wt.isMain ? ' (main)' : '';
            const branch = wt.branch ? ` [${wt.branch}]` : '';
            writeOutput(`${wt.path}${branch}${tag}`);
        }
    }
}

export async function runRemove(
    worktreePath: string,
    options: RemoveOptions,
    deps: WorktreeCommandDependencies,
): Promise<void> {
    const { cwd, writeOutput } = resolveDeps(deps);

    const gitRoot = await findGitRoot(cwd);
    if (!gitRoot) throw new Error(`Not inside a git repository: ${cwd}`);

    if (!options.force) {
        const baseBranch = await getCurrentBranch(cwd) ?? 'HEAD';
        const changes = await countWorktreeChanges(worktreePath, baseBranch);
        if (changes === null || changes.changedFiles > 0 || changes.commits > 0) {
            const detail = changes
                ? `${changes.changedFiles} changed file(s), ${changes.commits} unmerged commit(s)`
                : 'could not determine change count';
            throw new Error(
                `Worktree has uncommitted work (${detail}). Use --force to discard.`,
            );
        }
    }

    await removeWorktree(gitRoot, worktreePath, options.force ?? false);

    if (options.json) {
        writeOutput(JSON.stringify({ removed: worktreePath }, null, 2));
    } else {
        writeOutput(`Removed worktree: ${worktreePath}`);
    }
}

// ---------------------------------------------------------------------------
// Commander command factory
// ---------------------------------------------------------------------------

export function createWorktreeCommand(deps: WorktreeCommandDependencies = {}): Command {
    const command = new Command('worktree').description(
        'Manage git worktrees. Each worktree is an isolated checkout on its own branch.',
    );

    command
        .command('enter')
        .description('Create a new worktree and print its path.')
        .option('--name <name>', 'worktree name (slug); random if omitted')
        .option('--base-ref <ref>', 'git ref to branch from (default: HEAD)')
        .option('--json', 'output as JSON')
        .action((options: EnterOptions) => runSafely(() => runEnter(options, deps)));

    command
        .command('list')
        .description('List all worktrees for the current repository.')
        .option('--json', 'output as JSON')
        .action((options: JsonOption) => runSafely(() => runList(options, deps)));

    command
        .command('remove')
        .description('Remove a worktree by path.')
        .argument('<path>', 'absolute path to the worktree')
        .option('--force', 'discard uncommitted changes')
        .option('--json', 'output as JSON')
        .action((wtPath: string, options: RemoveOptions) =>
            runSafely(() => runRemove(wtPath, options, deps)),
        );

    return command;
}

export const worktreeCommand = createWorktreeCommand();
