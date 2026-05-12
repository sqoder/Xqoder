// P19c — In-process worktree session state.
//
// Tracks the single active worktree session per process (mirrors openclaude's
// getCurrentWorktreeSession / saveWorktreeState pattern but without the
// sessionStorage dependency — we keep it in a module-level variable so the
// core layer stays free of infrastructure imports).

import * as crypto from 'node:crypto';
import type { WorktreeSession } from './worktree-types.js';

let _current: WorktreeSession | null = null;

export function getCurrentWorktreeSession(): WorktreeSession | null {
    return _current;
}

export function setCurrentWorktreeSession(session: WorktreeSession | null): void {
    _current = session;
}

export function createWorktreeSession(
    worktreePath: string,
    worktreeBranch: string,
    originalCwd: string,
    name: string,
): WorktreeSession {
    return {
        id: crypto.randomUUID(),
        name,
        worktreePath,
        worktreeBranch,
        originalCwd,
        createdAt: new Date(),
    };
}

/** Reset for tests. */
export function __resetWorktreeSessionForTests(): void {
    _current = null;
}
