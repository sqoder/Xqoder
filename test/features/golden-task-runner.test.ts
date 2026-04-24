import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'bun:test';
import {
    evaluateGoldenTaskResponse,
    runGoldenTaskBatch,
    type GoldenTaskDefinition,
} from '../../src/features/eval/golden-task-runner.js';
import { summarizeGoldenSessionMetrics } from '../../scripts/run-golden-tasks.ts';

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
            successRate: 0.5,
            avgDurationMs: expect.any(Number),
            avgSteps: 0,
            totalToolFailures: 0,
            toolFailureRate: 0,
            totalApprovals: 0,
            approvalInterruptionRate: 0,
            totalRollbacks: 0,
            rollbackRate: 0,
        });
        expect(result.results[0]?.ok).toBe(true);
        expect(result.results[0]?.steps).toBeUndefined();
        expect(result.results[1]?.ok).toBe(false);
        expect(result.results[1]?.toolFailures).toBeUndefined();
        expect(result.results[1]?.rollbacks).toBeUndefined();
    });

    it('counts restore entries as rollbacks without treating rollback checkpoints as rollbacks', () => {
        const metrics = summarizeGoldenSessionMetrics({
            getToolHistory: () => [
                { success: true },
                { success: false },
            ],
            getApprovalHistory: () => [
                { decision: 'allow' },
                { decision: 'deny' },
            ],
            getFileChanges: () => [
                { changeType: 'write', rollbackPointId: 'checkpoint-write' },
                { changeType: 'patch', rollbackPointId: 'checkpoint-patch' },
                { changeType: 'restore' },
            ],
        }, 5);

        expect(metrics).toMatchObject({
            steps: 5,
            toolFailures: 1,
            approvals: 2,
            approvalInterruptions: 1,
            rollbacks: 1,
            humanTakeover: true,
        });
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

    it('exposes the live coding manifest through dry-run without enabling fallback', () => {
        const result = spawnSync('bun', [
            'run',
            'eval:golden:live',
            '--',
            '--dry-run',
        ], {
            cwd: repoRoot,
            encoding: 'utf-8',
            env: {
                ...process.env,
                XQODER_LLM_API_KEY: 'dry-run-key',
                XQODER_LLM_PROVIDER: 'openai',
                XQODER_LLM_MODEL: 'dry-run-model',
            },
        });

        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout.trim()) as {
            mode: string;
            fallbackEnabled: boolean;
            summary: { total: number; requiredPassRate: number };
            taskIds: string[];
        };
        expect(payload.mode).toBe('live');
        expect(payload.fallbackEnabled).toBe(false);
        expect(payload.summary.total).toBe(10);
        expect(payload.summary.requiredPassRate).toBe(0.7);
        expect(payload.taskIds).toContain('live-01-bug-fix');
        expect(payload.taskIds).toContain('live-10-dangerous-bash-denied');
    });

    it('does not require live provider credentials for live dry-run manifest inspection', () => {
        const result = spawnSync('bun', [
            'run',
            'eval:golden:live',
            '--',
            '--dry-run',
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

        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout.trim()) as {
            mode: string;
            fallbackEnabled: boolean;
            summary: { total: number; dryRun: boolean; requiredPassRate: number };
            provider?: unknown;
        };
        expect(payload.mode).toBe('live');
        expect(payload.fallbackEnabled).toBe(false);
        expect(payload.summary.total).toBe(10);
        expect(payload.summary.dryRun).toBe(true);
        expect(payload.summary.requiredPassRate).toBe(0.7);
        expect(payload.provider).toBeUndefined();
    });
});
