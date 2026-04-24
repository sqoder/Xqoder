import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'bun:test';
import {
    evaluateGoldenTaskResponse,
    runGoldenTaskBatch,
    type GoldenTaskDefinition,
} from '../../src/features/eval/golden-task-runner.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

describe('golden task runner', () => {
    it('evaluates expected and forbidden substrings deterministically', () => {
        const evaluation = evaluateGoldenTaskResponse({
            id: 'task-1',
            title: 'Check response',
            prompt: 'hello',
            cwd: '/workspace',
            expectedAll: ['alpha', 'beta'],
            expectedAny: ['gamma', 'delta'],
            forbidden: ['panic'],
        }, 'Alpha and beta are present. Delta also appears.');

        expect(evaluation.ok).toBe(true);
        expect(evaluation.missingAll).toEqual([]);
        expect(evaluation.matchedAny).toEqual(['delta']);
        expect(evaluation.matchedForbidden).toEqual([]);
    });

    it('aggregates batch pass rate across successful and failed tasks', async () => {
        const tasks: GoldenTaskDefinition[] = [
            {
                id: 'task-pass',
                title: 'Passing task',
                prompt: 'pass',
                cwd: '/workspace',
                expectedAll: ['done'],
            },
            {
                id: 'task-fail',
                title: 'Failing task',
                prompt: 'fail',
                cwd: '/workspace',
                expectedAll: ['done'],
            },
        ];

        const result = await runGoldenTaskBatch(tasks, {
            async run(task) {
                return {
                    response: task.id === 'task-pass' ? 'done successfully' : 'missing keyword',
                };
            },
        });

        expect(result.summary).toEqual({
            total: 2,
            passed: 1,
            failed: 1,
            passRate: 0.5,
        });
        expect(result.results[0]?.ok).toBe(true);
        expect(result.results[1]?.ok).toBe(false);
    });

    it('fails live CLI mode instead of falling back when no real provider credential exists', () => {
        const result = spawnSync('bun', [
            'run',
            'scripts/run-golden-tasks.ts',
            '--manifest',
            'docs/golden-tasks/xqoder-internal.sample.json',
            '--live',
        ], {
            cwd: repoRoot,
            encoding: 'utf-8',
            env: {
                ...process.env,
                XQODER_GOLDEN_LIVE: '1',
                XQODER_LLM_API_KEY: '',
                XQODER_LLM_PROVIDER: '',
                XQODER_LLM_MODEL: '',
                OPENAI_API_KEY: '',
                DASHSCOPE_API_KEY: '',
                ANTHROPIC_API_KEY: '',
                GEMINI_API_KEY: '',
                OPENROUTER_API_KEY: '',
            },
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Live golden mode requires a real LLM credential');
        expect(result.stdout).not.toContain('Repository evidence fallback');
    });
});
