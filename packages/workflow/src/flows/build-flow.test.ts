import { describe, expect, it } from 'vitest';
import {
    ProjectType,
    RuntimeErrorType,
    RuntimeStatus,
    TestStatus,
    WorkflowStatus,
} from '@xqoder/shared';
import { runBuildProjectFlow } from './build-flow.js';

describe('runBuildProjectFlow', () => {
    it('runs the build steps and returns runtime and test artifacts', async () => {
        const calls: string[] = [];

        const result = await runBuildProjectFlow({
            userRequest: 'build a vite blog',
            projectConfig: {
                rootDir: '/tmp/vite-blog',
                type: ProjectType.Node,
                name: 'vite-blog',
            },
            analyzeRequirements: async () => {
                calls.push('analyze');
                return 'Use Vite + React';
            },
            generateStructure: async (analysis) => {
                calls.push(`structure:${analysis}`);
                return 'created structure';
            },
            generateCode: async (analysis) => {
                calls.push(`code:${analysis}`);
                return 'created code';
            },
            installDependencies: async () => {
                calls.push('install');
                return 'installed dependencies';
            },
            runtimeFactory: () => ({
                start: async () => {
                    calls.push('run');
                    return {
                        status: RuntimeStatus.Running,
                        projectDir: '/tmp/vite-blog',
                        projectType: ProjectType.Node,
                        packageManager: 'npm',
                        command: 'npm run dev',
                        port: 5173,
                        url: 'http://localhost:5173',
                        errors: [],
                        logs: [],
                        startedAt: new Date(),
                    };
                },
                stop: async () => {
                    calls.push('stop');
                },
            }),
            testProject: async () => {
                calls.push('test');
                return {
                    status: TestStatus.Passed,
                    projectDir: '/tmp/vite-blog',
                    packageManager: 'npm',
                    command: 'npm run test',
                    output: 'Tests 1 passed',
                    passed: 1,
                    failed: 0,
                    skipped: 0,
                    failures: [],
                    startedAt: new Date(),
                    completedAt: new Date(),
                };
            },
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(result.runReport?.url).toBe('http://localhost:5173');
        expect(result.testReport?.status).toBe(TestStatus.Passed);
        expect(calls).toEqual([
            'analyze',
            'structure:Use Vite + React',
            'code:Use Vite + React',
            'install',
            'run',
            'stop',
            'test',
        ]);
    });

    it('fails when runtime verification does not reach a healthy state', async () => {
        const result = await runBuildProjectFlow({
            userRequest: 'build a broken app',
            projectConfig: {
                rootDir: '/tmp/broken-app',
                type: ProjectType.Node,
                name: 'broken-app',
            },
            analyzeRequirements: async () => 'Use Node',
            generateStructure: async () => 'created structure',
            generateCode: async () => 'created code',
            installDependencies: async () => 'installed dependencies',
            runtimeFactory: () => ({
                start: async () => ({
                    status: RuntimeStatus.Error,
                    projectDir: '/tmp/broken-app',
                    projectType: ProjectType.Node,
                    errors: [{ type: RuntimeErrorType.RuntimeException, message: 'missing dependency' }],
                    logs: [],
                    startedAt: new Date(),
                    completedAt: new Date(),
                }),
                stop: async () => {},
            }),
        });

        expect(result.status).toBe(WorkflowStatus.Failed);
        expect(result.error).toContain('missing dependency');
    });
});
