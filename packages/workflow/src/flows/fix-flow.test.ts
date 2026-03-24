import { describe, expect, it, vi } from 'vitest';
import {
    ProjectType,
    RuntimeErrorType,
    RuntimeStatus,
    WorkflowStatus,
    type ProjectConfig,
    type RunReport,
} from '@xqoder/shared';
import type { ErrorAnalysis } from '@xqoder/runtime';
import { runFixProjectFlow } from './fix-flow.js';

function createProjectConfig(): ProjectConfig {
    return {
        rootDir: '/tmp/demo',
        type: ProjectType.Node,
        name: 'demo',
    };
}

function createRunReport(overrides: Partial<RunReport> = {}): RunReport {
    return {
        status: RuntimeStatus.Running,
        projectDir: '/tmp/demo',
        projectType: ProjectType.Node,
        framework: 'vite',
        packageManager: 'pnpm',
        command: 'pnpm run dev',
        port: 5173,
        url: 'http://localhost:5173',
        pid: 1234,
        errors: [],
        logs: [],
        startedAt: new Date('2026-03-08T00:00:00Z'),
        ...overrides,
    };
}

function createAnalysis(summaryForAgent: string): ErrorAnalysis {
    return {
        errors: [{
            type: RuntimeErrorType.CompileError,
            message: 'Cannot assign string to number',
            file: 'src/main.ts',
            line: 3,
        }],
        autoFixCommands: [],
        summaryForAgent,
    };
}

describe('runFixProjectFlow', () => {
    it('short-circuits when the project is already healthy', async () => {
        const repairProject = vi.fn();
        const runtimeFactory = vi.fn(() => ({
            start: async () => createRunReport(),
            analyzeErrors: () => ({
                errors: [],
                autoFixCommands: [],
                summaryForAgent: '没有检测到错误。',
            }),
            stop: async () => undefined,
        }));

        const result = await runFixProjectFlow({
            userRequest: '修复项目错误',
            projectConfig: createProjectConfig(),
            runtimeFactory,
            repairProject,
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.initialRunReport.status).toBe(RuntimeStatus.Running);
        expect(result.attempts[0]?.repairOutput).toBeUndefined();
        expect(repairProject).not.toHaveBeenCalled();
        expect(runtimeFactory).toHaveBeenCalledTimes(1);
    });

    it('retries the repair loop until verification passes', async () => {
        const captures: Array<{ runReport: RunReport; analysis: ErrorAnalysis }> = [
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile failed',
                    }],
                }),
                analysis: createAnalysis('第一次检测到 src/main.ts 的类型错误'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'still broken',
                    }],
                }),
                analysis: createAnalysis('第一次修复后仍然报错'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.DependencyMissing,
                        message: 'missing react',
                    }],
                }),
                analysis: createAnalysis('第二次检测到依赖问题'),
            },
            {
                runReport: createRunReport(),
                analysis: {
                    errors: [],
                    autoFixCommands: [],
                    summaryForAgent: '没有检测到错误。',
                },
            },
        ];

        const repairProject = vi.fn(async ({ prompt }: { prompt: string }) => {
            expect(prompt).toContain('运行报告');
            expect(prompt).toContain('错误摘要');
            expect(prompt).toContain('修复策略');
            return 'repair applied';
        });

        const runtimeFactory = vi.fn(() => {
            const capture = captures.shift();
            if (!capture) {
                throw new Error('unexpected runtime factory call');
            }

            return {
                start: async () => capture.runReport,
                analyzeErrors: () => capture.analysis,
                stop: async () => undefined,
            };
        });

        const result = await runFixProjectFlow({
            userRequest: '修复项目错误',
            projectConfig: createProjectConfig(),
            runtimeFactory,
            repairProject,
            maxAttempts: 3,
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(result.attempts).toHaveLength(2);
        expect(result.attempts[0]?.workflowStatus).toBe(WorkflowStatus.Failed);
        expect(result.attempts[1]?.workflowStatus).toBe(WorkflowStatus.Completed);
        expect(result.attempts[1]?.verificationRunReport?.status).toBe(RuntimeStatus.Running);
        expect(result.attempts[0]).toMatchObject({
            suspectedFailureBucket: 'runtime_compile_error',
            remediationPolicyId: 'compile-error-v1',
        });
        expect(result.attempts[1]).toMatchObject({
            suspectedFailureBucket: 'runtime_dependency_missing',
            remediationPolicyId: 'dependency-missing-v1',
        });
        expect(result.appliedPolicyIds).toEqual([
            'compile-error-v1',
            'dependency-missing-v1',
        ]);
        expect(repairProject).toHaveBeenNthCalledWith(1, expect.objectContaining({
            suspectedFailureBucket: 'runtime_compile_error',
            remediationPolicy: expect.objectContaining({
                id: 'compile-error-v1',
            }),
        }));
        expect(repairProject).toHaveBeenNthCalledWith(2, expect.objectContaining({
            suspectedFailureBucket: 'runtime_dependency_missing',
            remediationPolicy: expect.objectContaining({
                id: 'dependency-missing-v1',
            }),
        }));
        expect(repairProject).toHaveBeenCalledTimes(2);
        expect(runtimeFactory).toHaveBeenCalledTimes(4);
    });

    it('short-circuits after a safe automatic action fixes the project', async () => {
        const captures: Array<{ runReport: RunReport; analysis: ErrorAnalysis }> = [
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.DependencyMissing,
                        message: 'Cannot find module react',
                    }],
                }),
                analysis: {
                    errors: [{
                        type: RuntimeErrorType.DependencyMissing,
                        message: 'Cannot find module react',
                    }],
                    autoFixCommands: ['npm install react'],
                    summaryForAgent: '检测到 react 缺失',
                },
            },
            {
                runReport: createRunReport(),
                analysis: {
                    errors: [],
                    autoFixCommands: [],
                    summaryForAgent: '没有检测到错误。',
                },
            },
        ];

        const repairProject = vi.fn();
        const applySafeAutomaticRemediation = vi.fn(async ({ remediationPolicy }) => {
            expect(remediationPolicy.id).toBe('dependency-missing-v1');
            return {
                actionId: 'auto-install-dependency-v1',
                summary: 'installed react',
                output: 'pnpm add react',
            };
        });

        const runtimeFactory = vi.fn(() => {
            const capture = captures.shift();
            if (!capture) {
                throw new Error('unexpected runtime factory call');
            }

            return {
                start: async () => capture.runReport,
                analyzeErrors: () => capture.analysis,
                stop: async () => undefined,
            };
        });

        const result = await runFixProjectFlow({
            userRequest: '修复项目错误',
            projectConfig: createProjectConfig(),
            runtimeFactory,
            repairProject,
            applySafeAutomaticRemediation,
            maxAttempts: 2,
        });

        expect(result).toMatchObject({
            status: WorkflowStatus.Completed,
            attemptCount: 1,
            appliedPolicyIds: ['dependency-missing-v1'],
            automaticActionIds: ['auto-install-dependency-v1'],
            observedFailureBuckets: ['runtime_dependency_missing'],
        });
        expect(result.attempts[0]).toMatchObject({
            remediationPolicyId: 'dependency-missing-v1',
            automaticActionId: 'auto-install-dependency-v1',
            automaticActionTriggerBucket: 'runtime_dependency_missing',
        });
        expect(repairProject).not.toHaveBeenCalled();
        expect(applySafeAutomaticRemediation).toHaveBeenCalledTimes(1);
        expect(runtimeFactory).toHaveBeenCalledTimes(2);
    });

    it('includes lsp diagnostics context in the repair prompt when available', async () => {
        const captures: Array<{ runReport: RunReport; analysis: ErrorAnalysis }> = [
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile failed',
                    }],
                }),
                analysis: {
                    ...createAnalysis('检测到 src/main.ts 的类型错误'),
                    lspDiagnosticsSummary: [
                        'LSP diagnostics:',
                        '- [ERROR] src/main.ts:3:7 TS2322 Type string is not assignable to number',
                    ].join('\n'),
                },
            },
            {
                runReport: createRunReport(),
                analysis: {
                    errors: [],
                    autoFixCommands: [],
                    summaryForAgent: '没有检测到错误。',
                },
            },
        ];

        const repairProject = vi.fn(async ({ prompt }: { prompt: string }) => {
            expect(prompt).toContain('LSP 诊断:');
            expect(prompt).toContain('TS2322');
            expect(prompt).toContain('src/main.ts:3:7');
            return 'repair applied';
        });

        const runtimeFactory = vi.fn(() => {
            const capture = captures.shift();
            if (!capture) {
                throw new Error('unexpected runtime factory call');
            }

            return {
                start: async () => capture.runReport,
                analyzeErrors: () => capture.analysis,
                stop: async () => undefined,
            };
        });

        const result = await runFixProjectFlow({
            userRequest: '修复项目错误',
            projectConfig: createProjectConfig(),
            runtimeFactory,
            repairProject,
            maxAttempts: 1,
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(repairProject).toHaveBeenCalledTimes(1);
    });

    it('escalates retry policy and includes prior attempt context when the same bucket repeats', async () => {
        const captures: Array<{ runReport: RunReport; analysis: ErrorAnalysis }> = [
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile failed',
                    }],
                }),
                analysis: createAnalysis('第一轮发现 src/main.ts 的类型错误'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile still failed',
                    }],
                }),
                analysis: createAnalysis('第一轮修完后还是同一个编译错误'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile failed again',
                    }],
                }),
                analysis: createAnalysis('第二轮进入同一类编译错误'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile still failed on attempt two',
                    }],
                }),
                analysis: createAnalysis('第二轮修完后还是同一个编译错误'),
            },
            {
                runReport: createRunReport({
                    status: RuntimeStatus.Error,
                    errors: [{
                        type: RuntimeErrorType.CompileError,
                        message: 'compile failed for the last attempt',
                    }],
                }),
                analysis: createAnalysis('第三轮进入最后一次同类修复'),
            },
            {
                runReport: createRunReport(),
                analysis: {
                    errors: [],
                    autoFixCommands: [],
                    summaryForAgent: '没有检测到错误。',
                },
            },
        ];

        const seenPolicies: string[] = [];
        const seenPrompts: string[] = [];
        const repairProject = vi.fn(async ({ prompt, remediationPolicy }: {
            prompt: string;
            remediationPolicy: { id: string };
        }) => {
            seenPolicies.push(remediationPolicy.id);
            seenPrompts.push(prompt);
            return `repair applied for ${remediationPolicy.id}`;
        });

        const runtimeFactory = vi.fn(() => {
            const capture = captures.shift();
            if (!capture) {
                throw new Error('unexpected runtime factory call');
            }

            return {
                start: async () => capture.runReport,
                analyzeErrors: () => capture.analysis,
                stop: async () => undefined,
            };
        });

        const result = await runFixProjectFlow({
            userRequest: '修复项目错误',
            projectConfig: createProjectConfig(),
            runtimeFactory,
            repairProject,
            maxAttempts: 9,
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(result.attemptCount).toBe(3);
        expect(seenPolicies).toEqual([
            'compile-error-v1',
            'compile-error-v2',
            'compile-error-v3',
        ]);
        expect(seenPrompts[1]).toContain('上一轮修复记录:');
        expect(seenPrompts[1]).toContain('第 1 轮');
        expect(seenPrompts[1]).toContain('compile-error-v1');
        expect(seenPrompts[2]).toContain('第 2 轮');
        expect(seenPrompts[2]).toContain('compile-error-v2');
        expect(result.appliedPolicyIds).toEqual([
            'compile-error-v1',
            'compile-error-v2',
            'compile-error-v3',
        ]);
        expect(runtimeFactory).toHaveBeenCalledTimes(6);
    });
});
