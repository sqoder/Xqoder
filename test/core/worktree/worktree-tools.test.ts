// P19c — worktree tools (EnterWorktree / ExitWorktree) unit tests.
//
// We mock the worktree-manager git operations so tests run without a real
// git repo, and use the session module's reset helper for isolation.

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as worktreeManager from '../../../src/core/worktree/worktree-manager.js';
import {
    __resetWorktreeSessionForTests,
    getCurrentWorktreeSession,
} from '../../../src/core/worktree/worktree-session.js';
import { EnterWorktreeTool, ExitWorktreeTool } from '../../../src/core/agent/tools/worktree-tools.js';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';

function makeContext(cwd = '/repo'): ToolContext {
    return { cwd, projectRoot: cwd };
}

afterEach(() => {
    __resetWorktreeSessionForTests();
});

// ---------------------------------------------------------------------------
// EnterWorktreeTool
// ---------------------------------------------------------------------------

describe('EnterWorktreeTool', () => {
    let tool: EnterWorktreeTool;

    beforeEach(() => {
        tool = new EnterWorktreeTool();
    });

    it('fails when not in a git repo', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue(null);

        const result = await tool.execute({ toolCallId: 'tc1', name: 'feat' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/git repository/i);
    });

    it('fails when already in a worktree session', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: '/repo/.claude/worktrees/feat',
            worktreeBranch: 'feat',
        });

        // Enter once
        await tool.execute({ toolCallId: 'tc1', name: 'feat' }, makeContext());

        // Second enter should fail
        const result = await tool.execute({ toolCallId: 'tc2', name: 'feat2' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already in a worktree/i);
    });

    it('rejects invalid slug', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');

        const result = await tool.execute({ toolCallId: 'tc1', name: '../escape' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid/i);
    });

    it('creates worktree and sets session on success', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: '/repo/.claude/worktrees/feat',
            worktreeBranch: 'feat',
        });

        const result = await tool.execute({ toolCallId: 'tc1', name: 'feat' }, makeContext());
        expect(result.success).toBe(true);
        expect(result.output).toContain('feat');
        expect(result.metadata?.['worktreePath']).toBe('/repo/.claude/worktrees/feat');
        expect(result.metadata?.['worktreeBranch']).toBe('feat');

        const session = getCurrentWorktreeSession();
        expect(session).not.toBeNull();
        expect(session?.name).toBe('feat');
        expect(session?.originalCwd).toBe('/repo');
    });

    it('generates a random slug when name is omitted', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        const addSpy = spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: '/repo/.claude/worktrees/abcd1234',
            worktreeBranch: 'abcd1234',
        });

        const result = await tool.execute({ toolCallId: 'tc1' }, makeContext());
        expect(result.success).toBe(true);
        // slug passed to addWorktree should be 8 hex chars
        const slug = addSpy.mock.calls[addSpy.mock.calls.length - 1]?.[1] as string;
        expect(slug).toMatch(/^[0-9a-f]{8}$/);
    });

    it('propagates addWorktree errors', async () => {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'addWorktree').mockRejectedValue(new Error('branch already exists'));

        const result = await tool.execute({ toolCallId: 'tc1', name: 'feat' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/branch already exists/);
    });
});

// ---------------------------------------------------------------------------
// ExitWorktreeTool
// ---------------------------------------------------------------------------

describe('ExitWorktreeTool', () => {
    let enter: EnterWorktreeTool;
    let exit: ExitWorktreeTool;

    beforeEach(() => {
        enter = new EnterWorktreeTool();
        exit = new ExitWorktreeTool();
    });

    async function enterWorktree(cwd = '/repo'): Promise<void> {
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue(cwd);
        spyOn(worktreeManager, 'addWorktree').mockResolvedValue({
            worktreePath: `${cwd}/.claude/worktrees/feat`,
            worktreeBranch: 'feat',
        });
        await enter.execute({ toolCallId: 'enter', name: 'feat' }, makeContext(cwd));
    }

    it('fails when not in a worktree session', async () => {
        const result = await exit.execute({ toolCallId: 'tc1', action: 'keep' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not in a worktree/i);
    });

    it('fails when action is missing or invalid', async () => {
        await enterWorktree();
        const result = await exit.execute({ toolCallId: 'tc1', action: 'invalid' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/action must be/i);
    });

    it('keep action clears session without removing worktree', async () => {
        await enterWorktree();
        const result = await exit.execute({ toolCallId: 'tc1', action: 'keep' }, makeContext());
        expect(result.success).toBe(true);
        expect(result.output).toContain('keep');
        expect(getCurrentWorktreeSession()).toBeNull();
    });

    it('remove action with no changes removes worktree', async () => {
        await enterWorktree();
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'getCurrentBranch').mockResolvedValue('main');
        spyOn(worktreeManager, 'countWorktreeChanges').mockResolvedValue({
            changedFiles: 0,
            commits: 0,
        });
        spyOn(worktreeManager, 'removeWorktree').mockResolvedValue(undefined);

        const result = await exit.execute({ toolCallId: 'tc1', action: 'remove' }, makeContext());
        expect(result.success).toBe(true);
        expect(getCurrentWorktreeSession()).toBeNull();
    });

    it('remove action refuses when there are uncommitted changes', async () => {
        await enterWorktree();
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        spyOn(worktreeManager, 'getCurrentBranch').mockResolvedValue('main');
        spyOn(worktreeManager, 'countWorktreeChanges').mockResolvedValue({
            changedFiles: 3,
            commits: 1,
        });

        const result = await exit.execute({ toolCallId: 'tc1', action: 'remove' }, makeContext());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/uncommitted work/i);
        // Session should still be active
        expect(getCurrentWorktreeSession()).not.toBeNull();
    });

    it('remove with discard_changes=true forces removal', async () => {
        await enterWorktree();
        spyOn(worktreeManager, 'findGitRoot').mockResolvedValue('/repo');
        const removeSpy = spyOn(worktreeManager, 'removeWorktree').mockResolvedValue(undefined);

        const result = await exit.execute(
            { toolCallId: 'tc1', action: 'remove', discard_changes: true },
            makeContext(),
        );
        expect(result.success).toBe(true);
        expect(removeSpy.mock.calls[removeSpy.mock.calls.length - 1]?.[2]).toBe(true); // force=true
        expect(getCurrentWorktreeSession()).toBeNull();
    });
});
