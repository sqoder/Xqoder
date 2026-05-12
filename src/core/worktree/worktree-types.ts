// P19c — Worktree types shared by worktree-manager, worktree-session, and tools.

export const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/;
export const MAX_WORKTREE_SLUG_LENGTH = 64;

export interface WorktreeSession {
    id: string;
    name: string;
    worktreePath: string;
    worktreeBranch: string;
    originalCwd: string;
    createdAt: Date;
}

export interface WorktreeInfo {
    path: string;
    branch?: string;
    head?: string;
    isBare: boolean;
    isMain: boolean;
}

export interface AddWorktreeResult {
    worktreePath: string;
    worktreeBranch: string;
}

/**
 * Validates a worktree slug to prevent path traversal.
 * Each "/" separated segment must match [a-zA-Z0-9._-]; total length <= 64.
 * Throws on invalid input.
 */
export function validateWorktreeSlug(name: string): void {
    if (!name || name.trim().length === 0) {
        throw new Error('Worktree name must not be empty');
    }
    if (name.length > MAX_WORKTREE_SLUG_LENGTH) {
        throw new Error(
            `Worktree name must be at most ${MAX_WORKTREE_SLUG_LENGTH} characters (got ${name.length})`,
        );
    }
    const segments = name.split('/');
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..' || !VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
            throw new Error(
                `Worktree name segment "${segment}" is invalid. Each segment may contain only letters, digits, dots, underscores, and dashes.`,
            );
        }
    }
}
