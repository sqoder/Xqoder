import { describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { runVerificationBridge } from '../../../src/application/chat/verification-bridge.js';
import type { ToolExecutionResult } from '../../../src/application/chat/tool-orchestrator.js';

describe('verification bridge', () => {
    it('returns a noop result when no runtime is provided', async () => {
        const session = new AgentSession({ id: 'verification-bridge-noop', systemPrompt: 'system' });

        const result = await runVerificationBridge({
            session,
        });

        expect(result).toEqual({
            invoked: false,
            triggered: false,
            blocked: false,
            appendedMessages: [],
        });
    });

    it('does not invoke the gate when a batch has no write or verification trigger', async () => {
        const session = new AgentSession({ id: 'verification-bridge-runtime', systemPrompt: 'system' });

        const result = await runVerificationBridge({
            session,
            runtime: {
                async runPostToolVerification() {
                    session.addMessage({
                        role: 'system',
                        content: 'Verification failed: tests still red',
                    });
                },
                getCompletionBlocker() {
                    return 'Do not finish yet.';
                },
            },
            taskMode: 'engineering_edit',
            executions: [createExecutionResult({
                id: 'read-only-batch',
                name: 'read_file',
                ok: true,
                outputForUser: 'const value = 1;',
            })],
        });

        expect(result).toEqual({
            invoked: false,
            triggered: false,
            blocked: false,
            appendedMessages: [],
        });
    });

    it('captures appended verification messages and block state from the runtime after a write batch', async () => {
        const session = new AgentSession({ id: 'verification-bridge-runtime-write', systemPrompt: 'system' });

        const result = await runVerificationBridge({
            session,
            runtime: {
                async runPostToolVerification() {
                    session.addMessage({
                        role: 'system',
                        content: 'Verification failed: tests still red',
                    });
                },
                getCompletionBlocker() {
                    return 'Do not finish yet.';
                },
            },
            taskMode: 'engineering_edit',
            executions: [createExecutionResult({
                id: 'write-runtime-batch',
                name: 'write_file',
                ok: true,
                outputForUser: 'updated file',
                filePath: 'src/index.ts',
            })],
        });

        expect(result.invoked).toBe(true);
        expect(result.runtimeInvoked).toBe(true);
        expect(result.triggered).toBe(true);
        expect(result.blocked).toBe(true);
        expect(result.appendedMessages).toEqual([
            {
                role: 'system',
                content: 'Verification failed: tests still red',
            },
        ]);
        expect(result.completionBlocker).toContain('Do not finish yet.');
    });

    it('blocks direct completion after a write when no verification runtime is available', async () => {
        const session = new AgentSession({ id: 'verification-bridge-write-blocker', systemPrompt: 'system' });
        session.recordToolExecution({
            id: 'write-no-runtime',
            name: 'write_file',
            args: { path: 'src/index.ts' },
            success: true,
            output: 'updated file',
            startedAt: new Date('2026-04-22T15:00:00.000Z'),
            completedAt: new Date('2026-04-22T15:00:01.000Z'),
        });

        const blocked = await runVerificationBridge({
            session,
            taskMode: 'engineering_edit',
        });

        expect(blocked.invoked).toBe(true);
        expect(blocked.blocked).toBe(true);
        expect(blocked.appendedMessages).toEqual([{
            role: 'system',
            content: [
                'Do not finish yet.',
                'The latest file write still needs a successful verification pass.',
                'Run verification after the write, then continue only after it passes.',
            ].join('\n'),
        }]);
        expect(blocked.completionBlocker).toContain('latest file write still needs a successful verification pass');

        session.recordToolExecution({
            id: 'verify-no-runtime',
            name: 'run_shell',
            args: { command: 'bun test' },
            success: true,
            output: 'tests passed cleanly',
            startedAt: new Date('2026-04-22T15:00:02.000Z'),
            completedAt: new Date('2026-04-22T15:00:03.000Z'),
        });

        const cleared = await runVerificationBridge({
            session,
            taskMode: 'engineering_edit',
            executions: [createExecutionResult({
                id: 'verify-no-runtime',
                name: 'run_shell',
                ok: true,
                args: { command: 'bun test' },
                outputForUser: 'tests passed cleanly',
            })],
        });

        expect(cleared.invoked).toBe(true);
        expect(cleared.blocked).toBe(false);
        expect(cleared.triggered).toBe(true);
        expect(cleared.appendedMessages).toEqual([{
            role: 'system',
            content: 'Verification passed via tool evidence.',
        }]);
        expect(cleared.completionBlocker).toBeUndefined();
    });

    it('enforces reproduce -> fix -> verify for debug_fix even when runtime verification passes', async () => {
        const session = new AgentSession({ id: 'verification-bridge-debug-fix', systemPrompt: 'system' });
        session.recordToolExecution({
            id: 'write-before-repro',
            name: 'write_file',
            args: { path: 'src/utils.ts' },
            success: true,
            output: 'patched TypeError guard',
            startedAt: new Date('2026-04-22T15:10:00.000Z'),
            completedAt: new Date('2026-04-22T15:10:01.000Z'),
        });

        const blocked = await runVerificationBridge({
            session,
            taskMode: 'debug_fix',
            runtime: {
                async runPostToolVerification() {
                    session.addMessage({
                        role: 'system',
                        content: 'Runtime verification passed.',
                    });
                },
                getCompletionBlocker() {
                    return undefined;
                },
            },
            executions: [createExecutionResult({
                id: 'write-before-repro',
                name: 'write_file',
                ok: true,
                outputForUser: 'patched TypeError guard',
                filePath: 'src/utils.ts',
            })],
        });

        expect(blocked.blocked).toBe(true);
        expect(blocked.appendedMessages).toEqual([
            {
                role: 'system',
                content: 'Runtime verification passed.',
            },
            {
                role: 'system',
                content: [
                    'Do not finish yet.',
                    'Task mode is debug_fix, so the latest fix must follow reproduce -> fix -> verify.',
                    'Reproduce the failure before the next write, then apply the fix again, then verify it.',
                ].join('\n'),
            },
        ]);
        expect(blocked.completionBlocker).toContain('reproduce -> fix -> verify');

        session.recordToolExecution({
            id: 'reproduce-typeerror',
            name: 'run_shell',
            args: { command: 'bun test src/utils.test.ts' },
            success: false,
            output: 'TypeError: Cannot read properties of undefined',
            error: 'exit 1',
            startedAt: new Date('2026-04-22T15:10:02.000Z'),
            completedAt: new Date('2026-04-22T15:10:03.000Z'),
        });
        session.recordToolExecution({
            id: 'write-after-repro',
            name: 'write_file',
            args: { path: 'src/utils.ts' },
            success: true,
            output: 'patched TypeError guard again',
            startedAt: new Date('2026-04-22T15:10:04.000Z'),
            completedAt: new Date('2026-04-22T15:10:05.000Z'),
        });

        const cleared = await runVerificationBridge({
            session,
            taskMode: 'debug_fix',
            runtime: {
                async runPostToolVerification() {
                    session.addMessage({
                        role: 'system',
                        content: 'Runtime verification passed again.',
                    });
                },
                getCompletionBlocker() {
                    return undefined;
                },
            },
            executions: [createExecutionResult({
                id: 'write-after-repro',
                name: 'write_file',
                ok: true,
                outputForUser: 'patched TypeError guard again',
                filePath: 'src/utils.ts',
            })],
        });

        expect(cleared.blocked).toBe(false);
        expect(cleared.appendedMessages).toEqual([
            {
                role: 'system',
                content: 'Runtime verification passed again.',
            },
        ]);
        expect(cleared.completionBlocker).toBeUndefined();
    });
});

function createExecutionResult(input: {
    id: string;
    name: string;
    ok: boolean;
    args?: Record<string, unknown>;
    outputForUser: string;
    filePath?: string;
}): ToolExecutionResult {
    return {
        id: input.id,
        name: input.name,
        args: input.args ?? (input.filePath ? { path: input.filePath } : {}),
        ok: input.ok,
        outputForModel: input.outputForUser,
        outputForUser: input.outputForUser,
        stages: [],
        commandHistory: [],
        fileChanges: input.filePath
            ? [{
                id: `${input.id}:file-change`,
                path: input.filePath,
                changeType: 'write',
                bytes: input.outputForUser.length,
                success: true,
                timestamp: new Date('2026-04-22T15:00:00.000Z'),
            }]
            : [],
        modelMessages: [],
        rendererEvents: [],
        transcriptEntries: [],
        eventStoreRecords: [],
        checkpoint: {
            required: Boolean(input.filePath),
            delegated: Boolean(input.filePath),
            status: input.filePath ? 'captured' : 'not_required',
        },
    };
}
