import { describe, expect, it } from 'vitest';
import {
    ProjectType,
    RuntimeErrorType,
    RuntimeStatus,
    type RunReport,
} from '@xqoder/shared';
import type { ErrorAnalysis } from '@xqoder/runtime';
import {
    deriveRemediationFailureBucket,
    resolveRemediationMaxAttempts,
    resolveRemediationPolicy,
} from './remediation-policy.js';

function createRunReport(overrides: Partial<RunReport> = {}): RunReport {
    return {
        status: RuntimeStatus.Error,
        projectDir: '/tmp/demo',
        projectType: ProjectType.Node,
        framework: 'vite',
        packageManager: 'pnpm',
        command: 'pnpm run dev',
        errors: [],
        logs: [],
        startedAt: new Date('2026-03-22T00:00:00.000Z'),
        ...overrides,
    };
}

function createAnalysis(overrides: Partial<ErrorAnalysis> = {}): ErrorAnalysis {
    return {
        errors: [{
            type: RuntimeErrorType.DependencyMissing,
            message: 'Cannot find module react',
        }],
        autoFixCommands: ['npm install react'],
        summaryForAgent: 'Cannot find module react',
        ...overrides,
    };
}

describe('remediation policy', () => {
    it('derives dependency remediation policy from runtime failures', () => {
        const bucket = deriveRemediationFailureBucket({
            runReport: createRunReport({
                errors: [{
                    type: RuntimeErrorType.DependencyMissing,
                    message: 'Cannot find module react',
                }],
            }),
            analysis: createAnalysis(),
        });
        const policy = resolveRemediationPolicy({
            runReport: createRunReport(),
            analysis: createAnalysis(),
        });

        expect(bucket).toBe('runtime_dependency_missing');
        expect(policy).toMatchObject({
            bucket: 'runtime_dependency_missing',
            id: 'dependency-missing-v1',
        });
        expect(policy.instructions).toContain('确认缺失的是第三方依赖、工作区包，还是本地相对路径文件。');
        expect(policy.suggestedCommands).toContain('pnpm add react');
    });

    it('normalizes verification buckets into reusable remediation policies', () => {
        const policy = resolveRemediationPolicy({
            failureBucket: 'verification_compile_error',
        });

        expect(policy).toMatchObject({
            bucket: 'runtime_compile_error',
            id: 'compile-error-v1',
        });
        expect(policy.verification).toContain('优先运行最小可复现的编译或启动命令，确认错误已经消失。');
    });

    it('routes deploy auth failures to a dedicated deploy policy', () => {
        const policy = resolveRemediationPolicy({
            failureBucket: 'deploy_auth_failed',
        });

        expect(policy).toMatchObject({
            bucket: 'deploy_auth_failed',
            id: 'deploy-auth-v1',
        });
        expect(policy.instructions).toContain('核对部署平台 token、scope、组织权限和 CI 注入方式是否一致。');
    });

    it('escalates the remediation policy when the same bucket repeats on the next attempt', () => {
        const policy = resolveRemediationPolicy({
            runReport: createRunReport({
                errors: [{
                    type: RuntimeErrorType.CompileError,
                    message: 'Type string is not assignable to number',
                }],
            }),
            analysis: createAnalysis({
                errors: [{
                    type: RuntimeErrorType.CompileError,
                    message: 'Type string is not assignable to number',
                    file: 'src/main.ts',
                    line: 1,
                }],
                autoFixCommands: [],
                summaryForAgent: '第二轮仍然是同一个编译错误',
            }),
            attempt: 2,
            maxAttempts: 3,
            previousAttempts: [{
                attempt: 1,
                suspectedFailureBucket: 'runtime_compile_error',
                remediationPolicyId: 'compile-error-v1',
                failureBucket: 'verification_compile_error',
            }],
        });

        expect(policy).toMatchObject({
            bucket: 'runtime_compile_error',
            id: 'compile-error-v2',
            retryStage: 'escalated',
            maxAttempts: 3,
        });
        expect(policy.instructions).toContain('不要重复上一轮完全相同的修改路径，先说明上一轮为什么没有真正消除报错。');
    });

    it('switches to the final-attempt policy on the last retry of the same bucket', () => {
        const policy = resolveRemediationPolicy({
            failureBucket: 'verification_compile_error',
            attempt: 3,
            maxAttempts: 5,
            previousAttempts: [
                {
                    attempt: 1,
                    suspectedFailureBucket: 'runtime_compile_error',
                    remediationPolicyId: 'compile-error-v1',
                    failureBucket: 'verification_compile_error',
                },
                {
                    attempt: 2,
                    suspectedFailureBucket: 'runtime_compile_error',
                    remediationPolicyId: 'compile-error-v2',
                    failureBucket: 'verification_compile_error',
                },
            ],
        });

        expect(policy).toMatchObject({
            bucket: 'runtime_compile_error',
            id: 'compile-error-v3',
            retryStage: 'final',
            maxAttempts: 3,
        });
        expect(policy.summary).toContain('最后一次');
    });

    it('caps remediation retry budgets at three attempts', () => {
        expect(resolveRemediationMaxAttempts()).toBe(3);
        expect(resolveRemediationMaxAttempts(1)).toBe(1);
        expect(resolveRemediationMaxAttempts(9)).toBe(3);
    });
});
