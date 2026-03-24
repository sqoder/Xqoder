import { describe, expect, it } from 'vitest';
import {
    DeployStatus,
    DeployTarget,
    ProjectType,
    WorkflowStatus,
} from '@xqoder/shared';
import { runDeployProjectFlow } from './deploy-flow.js';

describe('runDeployProjectFlow', () => {
    it('returns a completed workflow when deployment succeeds', async () => {
        const result = await runDeployProjectFlow({
            userRequest: 'deploy project',
            projectConfig: {
                rootDir: '/tmp/demo-deploy',
                type: ProjectType.Node,
                name: 'demo-deploy',
            },
            prepareDeployConfig: async () => ({
                target: DeployTarget.Vercel,
                projectDir: '/tmp/demo-deploy',
                buildCommand: 'pnpm build',
                outputDir: 'dist',
            }),
            validateDeployConfig: async () => ({
                valid: true,
                errors: [],
            }),
            deployProject: async () => ({
                status: DeployStatus.Ready,
                projectDir: '/tmp/demo-deploy',
                buildCommand: 'pnpm build',
                outputDir: 'dist',
                url: 'https://demo.vercel.app',
                target: DeployTarget.Vercel,
                deployId: 'demo',
                startedAt: new Date(),
                completedAt: new Date(),
            }),
        });

        expect(result).toMatchObject({
            status: WorkflowStatus.Completed,
            attemptCount: 1,
            automaticActionIds: ['deploy-config-preflight-v1'],
            resultLabel: 'https://demo.vercel.app',
            deployResult: {
                target: DeployTarget.Vercel,
            },
        });
    });

    it('records validation failures as a dedicated bucket', async () => {
        const result = await runDeployProjectFlow({
            userRequest: 'deploy project',
            projectConfig: {
                rootDir: '/tmp/demo-deploy',
                type: ProjectType.Node,
                name: 'demo-deploy',
            },
            prepareDeployConfig: async () => ({
                target: DeployTarget.Vercel,
                projectDir: '/tmp/demo-deploy',
                buildCommand: 'pnpm build',
                outputDir: '',
            }),
            validateDeployConfig: async () => ({
                valid: false,
                errors: ['输出目录不能为空'],
            }),
            deployProject: async () => ({
                status: DeployStatus.Failed,
                projectDir: '/tmp/demo-deploy',
                buildCommand: 'pnpm build',
                outputDir: '',
                target: DeployTarget.Vercel,
                error: '输出目录不能为空',
                startedAt: new Date(),
                completedAt: new Date(),
            }),
        });

        expect(result).toMatchObject({
            status: WorkflowStatus.Failed,
            automaticActionIds: ['deploy-config-preflight-v1'],
            failureBucket: 'deploy_validation_failed',
            resultLabel: DeployTarget.Vercel,
        });
    });
});
