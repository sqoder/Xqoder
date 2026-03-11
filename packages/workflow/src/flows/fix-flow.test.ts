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
        expect(repairProject).toHaveBeenCalledTimes(2);
        expect(runtimeFactory).toHaveBeenCalledTimes(4);
    });
});
