import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployStatus, DeployTarget } from '@xqoder/shared';
import { runFixCommand } from './fix.js';
import { createDeployCommand } from './deploy.js';
import {
    cleanupTempProjects,
    createIntegrationRuntime,
    createTempProjectFromFixture,
} from './fix.e2e-utils.js';

afterEach(() => {
    cleanupTempProjects();
});

describe('xqoder deploy integration', () => {
    it('runs a sample build -> fix -> deploy flow with a fake Vercel deployer', async () => {
        const projectDir = createTempProjectFromFixture('syntax-error');

        await runFixCommand({
            dir: projectDir,
            model: 'gpt-4o',
            maxAttempts: 2,
        }, {
            runtimeFactory: () => createIntegrationRuntime(),
            repairProject: async ({ projectConfig }) => {
                fs.writeFileSync(
                    path.join(projectConfig.rootDir, 'server.js'),
                    [
                        "console.log('boot ok');",
                        "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
                        'setInterval(() => {}, 10000);',
                        '',
                    ].join('\n'),
                );
                return 'rewrote server.js';
            },
        });

        execSync('npm run build', {
            cwd: projectDir,
            encoding: 'utf-8',
        });

        expect(fs.existsSync(path.join(projectDir, 'dist', 'index.html'))).toBe(true);

        const deploy = vi.fn(async (config) => ({
            status: DeployStatus.Ready,
            projectDir: config.projectDir,
            buildCommand: config.buildCommand,
            outputDir: config.outputDir,
            url: 'https://sample-project.vercel.app',
            target: DeployTarget.Vercel,
            deployId: 'sample-project',
            startedAt: new Date(),
            completedAt: new Date(),
        }));

        const command = createDeployCommand({
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        apiKey: '',
                    },
                    defaultDeployTarget: DeployTarget.Vercel,
                    vercel: {
                        scope: 'default-team',
                    },
                    recentProjects: [],
                    debug: false,
                }),
            },
            deployerFactory: () => ({
                target: DeployTarget.Vercel,
                deploy,
                getStatus: async () => DeployStatus.Ready,
                validateConfig: async () => ({ valid: true, errors: [] }),
            }),
        });

        await command.parseAsync([
            '--dir',
            projectDir,
        ], { from: 'user' });

        expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
            target: DeployTarget.Vercel,
            projectDir,
            outputDir: 'dist',
            buildCommand: 'npm run build',
            scope: 'default-team',
        }));
    }, 15000);

    it('lets --scope override the saved default scope', async () => {
        const deploy = vi.fn(async (config) => ({
            status: DeployStatus.Ready,
            projectDir: config.projectDir,
            buildCommand: config.buildCommand,
            outputDir: config.outputDir,
            url: 'https://sample-project.vercel.app',
            target: DeployTarget.Vercel,
            deployId: 'sample-project',
            startedAt: new Date(),
            completedAt: new Date(),
        }));

        const command = createDeployCommand({
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        apiKey: '',
                    },
                    defaultDeployTarget: DeployTarget.Vercel,
                    vercel: {
                        scope: 'default-team',
                    },
                    recentProjects: [],
                    debug: false,
                }),
            },
            deployerFactory: () => ({
                target: DeployTarget.Vercel,
                deploy,
                getStatus: async () => DeployStatus.Ready,
                validateConfig: async () => ({ valid: true, errors: [] }),
            }),
        });

        await command.parseAsync([
            '--dir',
            '.',
            '--scope',
            'override-team',
        ], { from: 'user' });

        expect(deploy).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'override-team',
        }));
    });
});
