import { describe, expect, it } from 'bun:test';
import { createAutoFixRunner } from '../../../src/core/agent/tools/auto-fix-runner.js';

describe('createAutoFixRunner', () => {
    it('returns empty message when no tool modifies files', async () => {
        const runner = createAutoFixRunner({
            runLint: async () => ({ ok: true, output: '' }),
            runTypeCheck: async () => ({ ok: true, output: '' }),
        });
        const outcome = await runner.runForTurn({
            executedTools: [{ name: 'read_file', modifiedFiles: [] }],
        });
        expect(outcome.triggered).toBe(false);
        expect(outcome.systemMessage).toBeUndefined();
    });

    it('runs lint + type-check when edit/write tool modified files and appends system message on failure', async () => {
        const calls = { lint: 0, tsc: 0 };
        const runner = createAutoFixRunner({
            runLint: async () => {
                calls.lint += 1;
                return { ok: false, output: "foo.ts:1:1: error: 'x' is not defined" };
            },
            runTypeCheck: async () => {
                calls.tsc += 1;
                return { ok: true, output: '' };
            },
        });

        const outcome = await runner.runForTurn({
            executedTools: [{ name: 'edit_file', modifiedFiles: ['foo.ts'] }],
        });

        expect(outcome.triggered).toBe(true);
        expect(calls.lint).toBe(1);
        expect(calls.tsc).toBe(1);
        expect(outcome.systemMessage).toContain('lint');
        expect(outcome.systemMessage).toContain("'x' is not defined");
    });

    it('skips when both checks pass', async () => {
        const runner = createAutoFixRunner({
            runLint: async () => ({ ok: true, output: '' }),
            runTypeCheck: async () => ({ ok: true, output: '' }),
        });
        const outcome = await runner.runForTurn({
            executedTools: [{ name: 'write_file', modifiedFiles: ['bar.ts'] }],
        });
        expect(outcome.triggered).toBe(true);
        expect(outcome.systemMessage).toBeUndefined();
    });

    it('caps invocations per turn at 2 and reports disabled after exceeding', async () => {
        const runner = createAutoFixRunner({
            runLint: async () => ({ ok: true, output: '' }),
            runTypeCheck: async () => ({ ok: true, output: '' }),
            maxPerTurn: 2,
        });

        await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['a.ts'] }] });
        await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['b.ts'] }] });
        const third = await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['c.ts'] }] });

        expect(third.triggered).toBe(false);
        expect(third.disabledReason).toBe('max_per_turn_exceeded');
    });

    it('resets counter when resetTurn is called', async () => {
        const runner = createAutoFixRunner({
            runLint: async () => ({ ok: true, output: '' }),
            runTypeCheck: async () => ({ ok: true, output: '' }),
            maxPerTurn: 1,
        });
        await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['a.ts'] }] });
        const blocked = await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['a.ts'] }] });
        expect(blocked.triggered).toBe(false);
        runner.resetTurn();
        const afterReset = await runner.runForTurn({ executedTools: [{ name: 'edit_file', modifiedFiles: ['a.ts'] }] });
        expect(afterReset.triggered).toBe(true);
    });

    it('treats only edit_file/write_file/apply_patch as triggering tools', async () => {
        const runner = createAutoFixRunner({
            runLint: async () => ({ ok: false, output: 'bad' }),
            runTypeCheck: async () => ({ ok: true, output: '' }),
        });
        const outcome = await runner.runForTurn({
            executedTools: [
                { name: 'read_file', modifiedFiles: [] },
                { name: 'grep_content', modifiedFiles: [] },
            ],
        });
        expect(outcome.triggered).toBe(false);
    });
});
