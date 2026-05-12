// P19c — `xqoder worktree` CLI tests.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as worktreeManager from '../../../src/core/worktree/worktree-manager.js';
import {
    runEnter,
    runList,
    runRemove,
} from '../../../src/commands/core/worktree.js';

function makeDeps(cwd = '/repo') {
    const lines: string[] = [];
    return {
        deps: { cwd, writeOutput: (l: string) => lines.push(l) },
        lines,
    };
}

describe('worktree CLI — enter', () => {
    it('prints worktree path and branch on success', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: '/repo/.claude/worktrees/feat',
            worktreeBranch: 'feat',
        });

        const { deps, lines } = makeDeps();
        await runEnter({ name: 'feat' }, deps);
        expect(lines.some((l) => l.includes('/repo/.claude/worktrees/feat'))).toBe(true);
        expect(lines.some((l) => l.includes('feat'))).toBe(true);
    });

    it('outputs JSON when --json is set', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: '/repo/.claude/worktrees/feat',
            worktreeBranch: 'feat',
        });

        const { deps, lines } = makeDeps();
        await runEnter({ name: 'feat', json: true }, deps);
        const parsed = JSON.parse(lines.join(''));
        expect(parsed.worktreePath).toBe('/repo/.claude/worktrees/feat');
        expect(parsed.worktreeBranch).toBe('feat');
        expect(parsed.slug).toBe('feat');
    });

    it('throws when not in a git repo', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue(null);
        const { deps } = makeDeps();
        await expect(runEnter({ name: 'feat' }, deps)).rejects.toThrow(/git repository/i);
    });

    it('throws on invalid slug', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        const { deps } = makeDeps();
        await expect(runEnter({ name: '../escape' }, deps)).rejects.toThrow(/invalid/i);
    });
});

describe('worktree CLI — list', () => {
    it('prints each worktree path', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'listWorktrees').mockResolvedValue([
            { path: '/repo', branch: 'main', isBare: false, isMain: true },
            { path: '/repo/.claude/worktrees/feat', branch: 'feat', isBare: false, isMain: false },
        ]);

        const { deps, lines } = makeDeps();
        await runList({}, deps);
        expect(lines.some((l) => l.includes('/repo'))).toBe(true);
        expect(lines.some((l) => l.includes('feat'))).toBe(true);
    });

    it('outputs JSON when --json is set', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'listWorktrees').mockResolvedValue([
            { path: '/repo', branch: 'main', isBare: false, isMain: true },
        ]);

        const { deps, lines } = makeDeps();
        await runList({ json: true }, deps);
        const parsed = JSON.parse(lines.join(''));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed[0].path).toBe('/repo');
    });

    it('prints "No worktrees found" when list is empty', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'listWorktrees').mockResolvedValue([]);

        const { deps, lines } = makeDeps();
        await runList({}, deps);
        expect(lines.some((l) => /no worktrees/i.test(l))).toBe(true);
    });
});

describe('worktree CLI — remove', () => {
    it('removes a clean worktree', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'getCurrentBranch').mockResolvedValue('main');
        spyOn(worktreeManager, 'countWorktreeChanges').mockResolvedValue({
            changedFiles: 0,
            commits: 0,
        });
        const removeSpy = spyOn(worktreeManager, 'removeWorktree').mockResolvedValue(undefined);

        const { deps, lines } = makeDeps();
        await runRemove('/repo/.claude/worktrees/feat', {}, deps);
        expect(removeSpy).toHaveBeenCalled();
        expect(lines.some((l) => l.includes('Removed'))).toBe(true);
    });

    it('throws when worktree has uncommitted changes without --force', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'getCurrentBranch').mockResolvedValue('main');
        spyOn(worktreeManager, 'countWorktreeChanges').mockResolvedValue({
            changedFiles: 2,
            commits: 0,
        });

        const { deps } = makeDeps();
        await expect(
            runRemove('/repo/.claude/worktrees/feat', {}, deps),
        ).rejects.toThrow(/uncommitted work/i);
    });

    it('removes with --force even when there are changes', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        const removeSpy = spyOn(worktreeManager, 'removeWorktree').mockResolvedValue(undefined);

        const { deps } = makeDeps();
        await runRemove('/repo/.claude/worktrees/feat', { force: true }, deps);
        expect(removeSpy.mock.calls[removeSpy.mock.calls.length - 1]?.[2]).toBe(true);
    });

    it('outputs JSON when --json is set', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'getCurrentBranch').mockResolvedValue('main');
        spyOn(worktreeManager, 'countWorktreeChanges').mockResolvedValue({
            changedFiles: 0,
            commits: 0,
        });
        spyOn(worktreeManager, 'removeWorktree').mockResolvedValue(undefined);

        const { deps, lines } = makeDeps();
        await runRemove('/repo/.claude/worktrees/feat', { json: true }, deps);
        const parsed = JSON.parse(lines.join(''));
        expect(parsed.removed).toBe('/repo/.claude/worktrees/feat');
    });
});
