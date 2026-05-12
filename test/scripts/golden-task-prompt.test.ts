import { describe, expect, it } from 'bun:test';
import { buildGoldenTaskPrompt } from '../../scripts/run-golden-tasks.js';
import type { GoldenTaskDefinition } from '../../src/core/golden-tasks/index.js';

function makeTask(overrides: Partial<GoldenTaskDefinition> = {}): GoldenTaskDefinition {
    return {
        id: 'test-task',
        title: 'Test task',
        prompt: 'What is the entry point of this project?',
        cwd: '/tmp',
        ...overrides,
    };
}

describe('buildGoldenTaskPrompt', () => {
    it('Bug 4: prompt contains mandatory final-answer instruction even when no expectedAll/expectedAny literals', () => {
        // Task with NO expected literals — literalHint is empty.
        // The prompt must still explicitly tell the model to output a text answer
        // after tool use, so it cannot silently finish inside the tool loop.
        const prompt = buildGoldenTaskPrompt(makeTask(), 0);
        // Must contain an explicit "write/output your answer" instruction
        expect(prompt.toLowerCase()).toMatch(/after.*tool|must.*write|write.*answer|output.*answer|text.*answer|your final answer/);
    });

    it('includes literal hints for expectedAll literals', () => {
        const prompt = buildGoldenTaskPrompt(makeTask({ expectedAll: ['src/index.ts'] }), 0);
        expect(prompt).toContain('src/index.ts');
    });

    it('retry attempt includes stronger instruction to include missing literals', () => {
        const prompt = buildGoldenTaskPrompt(makeTask(), 1);
        expect(prompt.toLowerCase()).toContain('retry');
    });

    it('slash-command prompts are returned unchanged', () => {
        const task = makeTask({ prompt: '/plan stabilize the router' });
        expect(buildGoldenTaskPrompt(task, 0)).toBe('/plan stabilize the router');
    });
});
