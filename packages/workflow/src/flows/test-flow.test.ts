import { describe, expect, it } from 'vitest';
import {
    ProjectType,
    TestStatus,
    WorkflowStatus,
} from '@xqoder/shared';
import { runTestProjectFlow } from './test-flow.js';

describe('runTestProjectFlow', () => {
    it('returns a completed workflow when tests pass', async () => {
        const result = await runTestProjectFlow({
            userRequest: 'run tests',
            projectConfig: {
                rootDir: '/tmp/demo-tests',
                type: ProjectType.Node,
                name: 'demo-tests',
            },
            testProject: async () => ({
                status: TestStatus.Passed,
                projectDir: '/tmp/demo-tests',
                packageManager: 'pnpm',
                command: 'pnpm test',
                output: '3 passed',
                passed: 3,
                failed: 0,
                skipped: 0,
                failures: [],
                startedAt: new Date(),
                completedAt: new Date(),
            }),
        });

        expect(result).toMatchObject({
            status: WorkflowStatus.Completed,
            attemptCount: 1,
            resultLabel: '3 passed',
            testReport: {
                command: 'pnpm test',
            },
        });
    });

    it('records failure buckets when tests fail', async () => {
        const result = await runTestProjectFlow({
            userRequest: 'run tests',
            projectConfig: {
                rootDir: '/tmp/demo-tests',
                type: ProjectType.Node,
                name: 'demo-tests',
            },
            testProject: async () => ({
                status: TestStatus.Failed,
                projectDir: '/tmp/demo-tests',
                packageManager: 'pnpm',
                command: 'pnpm test',
                output: 'FAIL should fail',
                passed: 0,
                failed: 1,
                skipped: 0,
                failures: [{
                    message: 'FAIL should fail',
                }],
                startedAt: new Date(),
                completedAt: new Date(),
            }),
        });

        expect(result).toMatchObject({
            status: WorkflowStatus.Failed,
            failureBucket: 'test_failed',
            resultLabel: '1 failed',
        });
    });
});
