// P19c — Worktree manager: thin wrapper around `git worktree` commands.
//
// All git operations use child_process.execFile (no execa / analytics deps)
// so this module stays in the core layer without pulling in infrastructure.

import { execFile as execFileCb } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { AddWorktreeResult, WorktreeInfo } from './worktree-types.js';
import { validateWorktreeSlug } from './worktree-types.js';

const execFile = promisify(execFileCb);

const GIT_TIMEOUT_MS = 15_000;

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    try {
        return await execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        throw new Error(e.stderr?.trim() || e.message || String(err));
    }
}

/**
 * Returns the canonical git root for `cwd` (follows `.git` file links for
 * existing worktrees). Returns null when `cwd` is not inside a git repo.
 */
export async function findGitRoot(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await git(['rev-parse', '--show-toplevel'], cwd);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Returns the default branch name (main / master / …) for the repo at `cwd`.
 */
export async function getDefaultBranch(cwd: string): Promise<string> {
    try {
        const { stdout } = await git(
            ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
            cwd,
        );
        const ref = stdout.trim();
        return ref.replace(/^origin\//, '') || 'main';
    } catch {
        // Fallback: check if main or master exists
        try {
            await git(['rev-parse', '--verify', 'main'], cwd);
            return 'main';
        } catch {
            return 'master';
        }
    }
}

/**
 * Returns the current branch name for `cwd`, or null when in detached HEAD.
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await git(['symbolic-ref', '--short', 'HEAD'], cwd);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Lists all worktrees for the repo at `cwd`.
 */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
    try {
        const { stdout } = await git(['worktree', 'list', '--porcelain'], cwd);
        return parseWorktreePorcelain(stdout);
    } catch {
        return [];
    }
}

function parseWorktreePorcelain(raw: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> | null = null;
    let isFirst = true;

    for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
            if (current) worktrees.push(finalise(current, isFirst && worktrees.length === 0));
            current = { path: line.slice('worktree '.length).normalize('NFC'), isBare: false };
            isFirst = false;
        } else if (line.startsWith('HEAD ') && current) {
            current.head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ') && current) {
            current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line === 'bare' && current) {
            current.isBare = true;
        }
    }
    if (current) worktrees.push(finalise(current, worktrees.length === 0));
    return worktrees;
}

function finalise(partial: Partial<WorktreeInfo>, isMain: boolean): WorktreeInfo {
    return {
        path: partial.path ?? '',
        branch: partial.branch,
        head: partial.head,
        isBare: partial.isBare ?? false,
        isMain,
    };
}

/**
 * Creates a new git worktree at `<gitRoot>/.claude/worktrees/<slug>` on a new
 * branch `<slug>` branched from `baseRef` (defaults to HEAD).
 *
 * Returns the worktree path and branch name.
 */
export async function addWorktree(
    gitRoot: string,
    slug: string,
    baseRef = 'HEAD',
): Promise<AddWorktreeResult> {
    validateWorktreeSlug(slug);

    const worktreePath = path.join(gitRoot, '.claude', 'worktrees', slug);
    const branchName = slug.replace(/\//g, '-');

    await git(
        ['worktree', 'add', '-b', branchName, worktreePath, baseRef],
        gitRoot,
    );

    return { worktreePath, worktreeBranch: branchName };
}

/**
 * Removes a worktree at `worktreePath`. Pass `force=true` to discard
 * uncommitted changes (equivalent to `git worktree remove --force`).
 */
export async function removeWorktree(
    gitRoot: string,
    worktreePath: string,
    force = false,
): Promise<void> {
    const args = ['worktree', 'remove', worktreePath];
    if (force) args.push('--force');
    await git(args, gitRoot);
}

/**
 * Counts uncommitted files and commits-ahead-of-base in a worktree.
 * Returns null when the state cannot be determined (e.g. corrupt index).
 */
export async function countWorktreeChanges(
    worktreePath: string,
    baseBranch: string,
): Promise<{ changedFiles: number; commits: number } | null> {
    try {
        const [statusResult, logResult] = await Promise.all([
            git(['status', '--porcelain'], worktreePath),
            git(['rev-list', '--count', `${baseBranch}..HEAD`], worktreePath),
        ]);
        const changedFiles = statusResult.stdout.trim().split('\n').filter(Boolean).length;
        const commits = parseInt(logResult.stdout.trim(), 10) || 0;
        return { changedFiles, commits };
    } catch {
        return null;
    }
}

/**
 * Generates a random worktree slug (8 hex chars).
 */
export function generateWorktreeSlug(): string {
    return crypto.randomBytes(4).toString('hex');
}
