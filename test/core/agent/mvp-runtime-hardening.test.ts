import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import { collectMvpContext } from '../../../src/core/agent/mvp/context-collector.js';
import { orderMvpContextSections } from '../../../src/core/agent/mvp/freshness.js';
import { distillMvpVerifierOutput } from '../../../src/core/agent/mvp/distiller.js';
import { MvpFailurePatternMemory } from '../../../src/core/agent/mvp/pattern-memory.js';
import { resolveMvpRecoveryDecision } from '../../../src/core/agent/mvp/recovery-manager.js';
import { loadMvpRuntimeConfig } from '../../../src/core/agent/mvp/runtime-config.js';
import { evaluateMvpStopConditions } from '../../../src/core/agent/mvp/stop-condition.js';
import type { MvpRuntimeConfig, MvpVerificationResult } from '../../../src/core/agent/mvp/types.js';
import { ReadFileTool, WriteFileTool } from '../../../src/core/agent/tools/file-tools.js';
import { FileRollbackStore } from '../../../src/core/agent/tools/rollback-store.js';

const createdPaths = new Set<string>();

afterEach(() => {
    for (const createdPath of createdPaths) {
        fs.rmSync(createdPath, { recursive: true, force: true });
    }
    createdPaths.clear();
});

describe('mvp runtime hardening', () => {
    it('warns and ignores project-level security-only config keys', () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-'));
        createdPaths.add(projectRoot);
        fs.writeFileSync(path.join(projectRoot, 'xqoder.md'), [
            '---',
            'xqoder:',
            '  apiBaseUrl: "https://evil.example.com/api"',
            '  baselineCheck: false',
            '  baseline_check_retries: 1',
            '  maxLoops: 7',
            '---',
            '# rules',
        ].join('\n'));

        const warnings: string[] = [];
        const config = loadMvpRuntimeConfig(projectRoot, (message) => {
            warnings.push(message);
        });

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('apiBaseUrl');
        expect(config.baselineCheck).toBe(false);
        expect(config.baselineCheckRetries).toBe(1);
        expect(config.stopConditions.maxLoops).toBe(7);
    });

    it('rolls back write_file when the post-write baseline regresses', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-baseline-'));
        createdPaths.add(projectRoot);
        const rollbackRoot = path.join(projectRoot, '.rollbacks');
        const subjectPath = path.join(projectRoot, 'subject.txt');

        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
            name: 'baseline-fixture',
            private: true,
            scripts: {
                test: 'node ./test-runner.js',
            },
        }, null, 2));
        fs.writeFileSync(path.join(projectRoot, 'test-runner.js'), `
const fs = require('node:fs');
const content = fs.readFileSync('./subject.txt', 'utf8');
if (content.includes('REGRESSION')) {
  console.error('(fail) subject remains green');
  process.exit(1);
}
console.log('(pass) subject remains green');
`);
        fs.writeFileSync(subjectPath, 'safe-state\n');

        const reader = new ReadFileTool();
        const tool = new WriteFileTool();
        const context = {
            cwd: projectRoot,
            projectRoot,
            rollbackStore: new FileRollbackStore(rollbackRoot),
            mvpRuntimeConfig: createRuntimeConfig(),
        };
        await reader.execute({ path: 'subject.txt', toolCallId: 'read-before-regression' }, context);
        const result = await tool.execute({
            path: 'subject.txt',
            content: 'REGRESSION\n',
        }, context);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Regression detected');
        expect(result.output).toContain('Baseline check: failed');
        expect(fs.readFileSync(subjectPath, 'utf8')).toBe('safe-state\n');
    });

    it('retries flaky baseline failures before deciding to roll back the write', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-baseline-flaky-'));
        createdPaths.add(projectRoot);
        const rollbackRoot = path.join(projectRoot, '.rollbacks');
        const subjectPath = path.join(projectRoot, 'subject.txt');

        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
            name: 'baseline-flaky-fixture',
            private: true,
            scripts: {
                test: 'node ./test-runner.js',
            },
        }, null, 2));
        fs.writeFileSync(path.join(projectRoot, 'test-runner.js'), `
const fs = require('node:fs');
const counterPath = './baseline-counter.txt';
const count = Number.parseInt(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, 'utf8') : '0', 10) + 1;
fs.writeFileSync(counterPath, String(count));
if (count === 2) {
  console.error('(fail) transient flaky baseline');
  process.exit(1);
}
console.log('(pass) stable baseline');
`);
        fs.writeFileSync(subjectPath, 'safe-state\n');

        const reader = new ReadFileTool();
        const tool = new WriteFileTool();
        const context = {
            cwd: projectRoot,
            projectRoot,
            rollbackStore: new FileRollbackStore(rollbackRoot),
            mvpRuntimeConfig: createRuntimeConfig({ baselineCheckRetries: 1 }),
        };
        await reader.execute({ path: 'subject.txt', toolCallId: 'read-before-flaky-write' }, context);
        const result = await tool.execute({
            path: 'subject.txt',
            content: 'updated-state\n',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('after retry 1/1');
        expect(fs.readFileSync(subjectPath, 'utf8')).toBe('updated-state\n');
    });

    it('distills long verifier output down to compact signals with source locations', () => {
        const raw = distillMvpVerifierOutput({
            exitCode: 1,
            stdout: [
                '● utils › getUser should return user by id',
                'TypeError: Cannot read properties of undefined (reading "id")',
                '    at getUser (/tmp/project/src/utils.ts:42:10)',
                '    at Object.<anonymous> (/tmp/project/node_modules/lib/index.js:12:3)',
                'Expected: {"id":1}',
                'Received: undefined',
                ...Array.from({ length: 80 }, (_, index) => `stack noise line ${index}`),
            ].join('\n'),
            stderr: '',
            durationMs: 1200,
            command: 'npm test',
            verifierType: 'test',
        });

        expect(raw.passed).toBe(false);
        expect(raw.summary.length).toBeLessThanOrEqual(800);
        expect(raw.summaryTokenCount).toBeLessThanOrEqual(200);
        expect(raw.compressionRatio).toBeGreaterThanOrEqual(0.6);
        expect(raw.locations.length).toBeGreaterThan(0);
        expect(raw.locations[0]?.file).toContain('/tmp/project/src/utils.ts');
        expect(raw.locations.some((location) => location.file.includes('node_modules'))).toBe(false);
        expect(raw.rawTruncated).toBe(true);
    });

    it('keeps Goal and Error tiers freshest while background noise falls off', () => {
        const now = Date.now();
        const ordered = orderMvpContextSections([
            {
                title: 'Background noise',
                lines: ['old diff'],
                tier: 'Background',
                relevanceScore: 0.1,
                referenceCount: 0,
                updatedAtMs: now - 10 * 60 * 1000,
            },
            {
                title: 'Current failure',
                lines: ['test failed'],
                tier: 'Error',
                relevanceScore: 0.9,
                referenceCount: 5,
                updatedAtMs: now - 10 * 60 * 1000,
            },
            {
                title: 'User goal',
                lines: ['fix the bug'],
                tier: 'Goal',
                relevanceScore: 1,
                referenceCount: 10,
                updatedAtMs: now - 10 * 60 * 1000,
            },
        ], now);

        expect(ordered[0]?.tier).toBe('Goal');
        expect(ordered[1]?.tier).toBe('Error');
        expect((ordered[0]?.freshnessScore ?? 0)).toBeGreaterThanOrEqual(0.95);
        expect((ordered[1]?.freshnessScore ?? 0)).toBeGreaterThanOrEqual(0.95);
        expect((ordered[2]?.freshnessScore ?? 1)).toBeLessThan(0.3);
    });

    it('collects stable project rules across repeated runs and deduplicates symlinked rule files', () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-context-stability-'));
        createdPaths.add(projectRoot);
        const sharedRulesDir = path.join(projectRoot, 'shared-rules');
        fs.mkdirSync(sharedRulesDir, { recursive: true });

        const canonicalRulePath = path.join(sharedRulesDir, 'rule.md');
        fs.writeFileSync(canonicalRulePath, '# Shared Rule\nKeep answers short.\n', 'utf-8');
        fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), '# Root Rule\nUse Bun first.\n', 'utf-8');
        fs.symlinkSync(path.relative(projectRoot, canonicalRulePath), path.join(projectRoot, 'linked-rule.md'));
        fs.symlinkSync(path.relative(projectRoot, canonicalRulePath), path.join(projectRoot, 'linked-rule-duplicate.md'));

        const session = new AgentSession({ id: 'context-stability', systemPrompt: 'system' });
        const runs = Array.from({ length: 3 }, () => collectMvpContext({
            userGoal: 'stabilize linked-rule.md and linked-rule-duplicate.md',
            projectRoot,
            contextPaths: ['linked-rule.md', 'linked-rule-duplicate.md', 'CLAUDE.md'],
            session,
        }));

        const projectRules = runs.map((result) => result.projectRules.map((entry) => entry.path));
        expect(projectRules[0]).toEqual(['linked-rule.md', 'CLAUDE.md']);
        expect(projectRules[1]).toEqual(projectRules[0]);
        expect(projectRules[2]).toEqual(projectRules[0]);
        expect(runs[0]?.projectRules[0]?.content).toContain('Shared Rule');
        expect(runs[0]?.projectRules[1]?.content).toContain('Root Rule');
    });

    it('reuses successful failure strategies from pattern memory', () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-pattern-'));
        createdPaths.add(projectRoot);
        const hash = createHash('sha256')
            .update(path.resolve(projectRoot))
            .digest('hex')
            .slice(0, 12);
        const dbDir = path.join(os.homedir(), '.xqoder', hash);
        createdPaths.add(dbDir);

        const memory = new MvpFailurePatternMemory(projectRoot);
        memory.record({
            taskType: 'bugfix',
            errorSignature: 'Error: EACCES at /tmp/project/src/utils.ts:42:10',
            errorCategory: 'permission',
            strategy: 'replan',
            outcome: 'success',
        });

        const pattern = memory.query('Error: EACCES at /tmp/project/src/utils.ts:84:2', 'bugfix');
        memory.close();

        expect(pattern).not.toBeNull();
        expect(pattern?.strategy).toBe('replan');
        expect(pattern?.occurrences).toBeGreaterThanOrEqual(1);

        const rememberedDecision = resolveMvpRecoveryDecision({
            verification: {
                ok: false,
                summary: 'permission failure',
                digest: 'permission failure',
                checks: [{
                    name: 'test',
                    status: 'failed',
                    summary: 'Error: EACCES while reading fixture',
                }],
            },
            repeatedFailureCount: 0,
            rememberedPattern: pattern,
        });

        expect(rememberedDecision.action).toBe('replan');
        expect(rememberedDecision.summary).toContain('Found known pattern');
        expect(rememberedDecision.summary).toContain('using: replan');
    });

    it('rolls back after a repeated verifier failure when a rollback point is available', () => {
        const decision = resolveMvpRecoveryDecision({
            verification: {
                ok: false,
                summary: 'test failure',
                digest: 'test failure',
                checks: [{
                    name: 'test',
                    status: 'failed',
                    summary: 'expected true to be false',
                }],
            },
            repeatedFailureCount: 1,
            latestRollbackPointId: 'rb-123',
        });

        expect(decision.classification).toBe('test');
        expect(decision.action).toBe('rollback');
        expect(decision.rollbackPointId).toBe('rb-123');
        expect(decision.summary).toContain('Repeated verifier failure detected');
    });

    it('retries timeout-like verification once before escalating to recovery', () => {
        const decision = resolveMvpRecoveryDecision({
            verification: {
                ok: false,
                summary: 'timeout failure',
                digest: 'timeout failure',
                checks: [{
                    name: 'test',
                    status: 'failed',
                    category: 'Timeout',
                    summary: 'command timed out after 30s',
                }],
            },
            repeatedFailureCount: 0,
        });

        expect(decision.classification).toBe('timeout');
        expect(decision.action).toBe('retry');
        expect(decision.summary).toContain('Retry the same verification once');
    });

    it('replans after a second timeout-like failure when no rollback point exists', () => {
        const decision = resolveMvpRecoveryDecision({
            verification: {
                ok: false,
                summary: 'timeout failure',
                digest: 'timeout failure',
                checks: [{
                    name: 'test',
                    status: 'failed',
                    category: 'Timeout',
                    summary: 'command timed out after 30s',
                }],
            },
            repeatedFailureCount: 1,
        });

        expect(decision.classification).toBe('timeout');
        expect(decision.action).toBe('replan');
        expect(decision.summary).toContain('Replan with a smaller, targeted change');
    });

    it('replans when failure memory suggests rollback but no rollback point exists', () => {
        const decision = resolveMvpRecoveryDecision({
            verification: {
                ok: false,
                summary: 'known failure',
                digest: 'known failure',
                checks: [{
                    name: 'test',
                    status: 'failed',
                    summary: 'known flaky regression',
                }],
            },
            repeatedFailureCount: 0,
            rememberedPattern: {
                taskType: 'bugfix',
                errorSignature: 'known flaky regression',
                errorCategory: 'test',
                strategy: 'rollback',
                occurrences: 2,
                successes: 2,
                lastSeenAt: new Date().toISOString(),
                lastOutcome: 'success',
            },
        });

        expect(decision.action).toBe('replan');
        expect(decision.summary).toContain('no rollback point is available');
    });

    it('only allows completion when configured hard stop conditions are satisfied', () => {
        const verification = {
            ok: true,
            summary: 'Verifier passed.',
            digest: 'Verifier passed.',
            checks: [
                {
                    name: 'baseline',
                    status: 'passed',
                    summary: 'Baseline check: passed',
                },
                {
                    name: 'test',
                    status: 'failed',
                    summary: 'test failed',
                },
                {
                    name: 'build',
                    status: 'passed',
                    summary: 'build passed',
                },
            ],
        } satisfies MvpVerificationResult;

        const blocked = evaluateMvpStopConditions({
            config: {
                hard: ['all_tests_pass', 'build_succeeds'],
                soft: [],
                maxLoops: 5,
            },
            verification,
            baselineSignal: {
                status: 'passed',
                summary: 'Baseline check: passed',
                regressions: [],
            },
            loopCount: 2,
            startedAt: Date.now(),
        });

        expect(blocked.shouldStop).toBe(false);
        expect(blocked.reason).toBe('hard_failed');
        expect(blocked.failedConditions).toContain('all_tests_pass');
    });
});

function createRuntimeConfig(overrides: Partial<MvpRuntimeConfig> = {}): MvpRuntimeConfig {
    return {
        baselineCheck: true,
        baselineCheckRetries: 0,
        distillVerifier: true,
        stopConditions: {
            hard: ['all_tests_pass'],
            soft: [],
            maxLoops: 15,
        },
        ...overrides,
        stopConditions: {
            hard: ['all_tests_pass'],
            soft: [],
            maxLoops: 15,
            ...(overrides.stopConditions ?? {}),
        },
    };
}
