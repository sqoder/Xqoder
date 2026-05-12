// P19c — Worktree tools (EnterWorktree / ExitWorktree).
//
// EnterWorktree: creates a git worktree, switches the session cwd into it.
// ExitWorktree:  returns to the original cwd, optionally removing the worktree.

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import {
    addWorktree,
    countWorktreeChanges,
    createWorktreeSession,
    findGitRoot,
    generateWorktreeSlug,
    getCurrentBranch,
    getCurrentWorktreeSession,
    removeWorktree,
    setCurrentWorktreeSession,
    validateWorktreeSlug,
} from '@xqoder/core-worktree';

function ok(toolCallId: string, output: string, metadata: Record<string, unknown>): ToolResult {
    return { toolCallId, success: true, output, metadata };
}

function fail(toolCallId: string, error: string): ToolResult {
    return { toolCallId, success: false, output: '', error };
}

// ---------------------------------------------------------------------------
// EnterWorktreeTool
// ---------------------------------------------------------------------------

export class EnterWorktreeTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'enter_worktree',
        description:
            'Create an isolated git worktree and switch the session into it. ' +
            'The worktree is created at <gitRoot>/.claude/worktrees/<name> on a new branch. ' +
            'Use exit_worktree to return. Only one worktree session is active at a time.',
        parameters: [
            {
                name: 'name',
                type: 'string',
                description:
                    'Optional name for the worktree. Each "/"-separated segment may contain only ' +
                    'letters, digits, dots, underscores, and dashes; max 64 chars total. ' +
                    'A random name is generated if not provided.',
                required: false,
            },
            {
                name: 'base_ref',
                type: 'string',
                description: 'Git ref to branch from (default: HEAD).',
                required: false,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        if (getCurrentWorktreeSession()) {
            return fail(toolCallId, 'Already in a worktree session. Call exit_worktree first.');
        }

        const nameArg = typeof args['name'] === 'string' ? args['name'].trim() : '';
        const slug = nameArg || generateWorktreeSlug();

        try {
            validateWorktreeSlug(slug);
        } catch (err) {
            return fail(toolCallId, (err as Error).message);
        }

        const baseRef = typeof args['base_ref'] === 'string' && args['base_ref'].trim()
            ? args['base_ref'].trim()
            : 'HEAD';

        const gitRoot = await findGitRoot(context.cwd);
        if (!gitRoot) {
            return fail(toolCallId, `Not inside a git repository: ${context.cwd}`);
        }

        let result: { worktreePath: string; worktreeBranch: string };
        try {
            result = await addWorktree(gitRoot, slug, baseRef);
        } catch (err) {
            return fail(toolCallId, `git worktree add failed: ${(err as Error).message}`);
        }

        const session = createWorktreeSession(
            result.worktreePath,
            result.worktreeBranch,
            context.cwd,
            slug,
        );
        setCurrentWorktreeSession(session);

        return ok(
            toolCallId,
            `Entered worktree "${slug}" at ${result.worktreePath} (branch: ${result.worktreeBranch}).`,
            {
                worktreePath: result.worktreePath,
                worktreeBranch: result.worktreeBranch,
                sessionId: session.id,
                originalCwd: context.cwd,
            },
        );
    }
}

// ---------------------------------------------------------------------------
// ExitWorktreeTool
// ---------------------------------------------------------------------------

export class ExitWorktreeTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'exit_worktree',
        description:
            'Exit the current worktree session and return to the original working directory. ' +
            'action="keep" leaves the worktree on disk; action="remove" deletes it. ' +
            'Set discard_changes=true to force removal even with uncommitted work.',
        parameters: [
            {
                name: 'action',
                type: 'string',
                description: '"keep" or "remove". Required.',
                required: true,
            },
            {
                name: 'discard_changes',
                type: 'boolean',
                description:
                    'Required true when action="remove" and the worktree has uncommitted files or unmerged commits.',
                required: false,
            },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const session = getCurrentWorktreeSession();
        if (!session) {
            return fail(toolCallId, 'Not in a worktree session.');
        }

        const action = typeof args['action'] === 'string' ? args['action'].trim() : '';
        if (action !== 'keep' && action !== 'remove') {
            return fail(toolCallId, 'action must be "keep" or "remove".');
        }

        const discardChanges = args['discard_changes'] === true;

        if (action === 'remove' && !discardChanges) {
            const gitRoot = await findGitRoot(session.worktreePath);
            if (gitRoot) {
                const baseBranch = await getCurrentBranch(session.originalCwd) ?? 'HEAD';
                const changes = await countWorktreeChanges(session.worktreePath, baseBranch);
                if (changes === null || changes.changedFiles > 0 || changes.commits > 0) {
                    const detail = changes
                        ? `${changes.changedFiles} changed file(s), ${changes.commits} unmerged commit(s)`
                        : 'could not determine change count';
                    return fail(
                        toolCallId,
                        `Worktree has uncommitted work (${detail}). ` +
                        'Pass discard_changes=true to force removal.',
                    );
                }
            }
        }

        if (action === 'remove') {
            const gitRoot = await findGitRoot(session.worktreePath);
            if (gitRoot) {
                try {
                    await removeWorktree(gitRoot, session.worktreePath, discardChanges);
                } catch (err) {
                    return fail(
                        toolCallId,
                        `git worktree remove failed: ${(err as Error).message}`,
                    );
                }
            }
        }

        setCurrentWorktreeSession(null);

        return ok(
            toolCallId,
            `Exited worktree "${session.name}" (action=${action}). Returned to ${session.originalCwd}.`,
            {
                action,
                originalCwd: session.originalCwd,
                worktreePath: session.worktreePath,
                worktreeBranch: session.worktreeBranch,
            },
        );
    }
}
