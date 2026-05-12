// P19c — worktree-session unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import {
    __resetWorktreeSessionForTests,
    createWorktreeSession,
    getCurrentWorktreeSession,
    setCurrentWorktreeSession,
} from '../../../src/core/worktree/worktree-session.js';

afterEach(() => {
    __resetWorktreeSessionForTests();
});

describe('worktree session state', () => {
    it('starts with no active session', () => {
        expect(getCurrentWorktreeSession()).toBeNull();
    });

    it('createWorktreeSession returns a session with all fields', () => {
        const session = createWorktreeSession(
            '/repo/.claude/worktrees/feat',
            'feat',
            '/repo',
            'feat',
        );
        expect(session.worktreePath).toBe('/repo/.claude/worktrees/feat');
        expect(session.worktreeBranch).toBe('feat');
        expect(session.originalCwd).toBe('/repo');
        expect(session.name).toBe('feat');
        expect(typeof session.id).toBe('string');
        expect(session.id.length).toBeGreaterThan(0);
        expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('setCurrentWorktreeSession stores and retrieves a session', () => {
        const session = createWorktreeSession('/wt', 'branch', '/orig', 'slug');
        setCurrentWorktreeSession(session);
        expect(getCurrentWorktreeSession()).toBe(session);
    });

    it('setCurrentWorktreeSession(null) clears the session', () => {
        const session = createWorktreeSession('/wt', 'branch', '/orig', 'slug');
        setCurrentWorktreeSession(session);
        setCurrentWorktreeSession(null);
        expect(getCurrentWorktreeSession()).toBeNull();
    });

    it('each createWorktreeSession call produces a unique id', () => {
        const a = createWorktreeSession('/wt', 'b', '/o', 's');
        const b = createWorktreeSession('/wt', 'b', '/o', 's');
        expect(a.id).not.toBe(b.id);
    });
});
