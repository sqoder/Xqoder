import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ProjectType,
    RuntimeStatus,
    TestStatus,
} from '@xqoder/shared';
import { createBuildCommand, runBuildCommand } from './build.js';

const tempDirs: string[] = [];

function createTempProjectDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-build-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTestConfigManager() {
    return {
        load: () => ({
            llm: {
                provider: 'openai' as const,
                model: 'gpt-4o',
                apiKey: '',
            },
            debug: false,
            recentProjects: [],
        }),
    };
}

describe('xqoder build integration', () => {
    it('runs the build workflow through the CLI command', async () => {
        const projectDir = createTempProjectDir();
        const agentRun = vi.fn(async (prompt: string) => {
            if (prompt.includes('只创建项目目录结构')) {
                fs.writeFileSync(
                    path.join(projectDir, 'package.json'),
                    JSON.stringify({
                        name: 'vite-blog',
                        private: true,
                        scripts: {
                            dev: 'node server.js',
                            test: 'node test.js',
                        },
                    }, null, 2),
                );
                return 'structure created';
            }

            fs.writeFileSync(
                path.join(projectDir, 'server.js'),
                [
                    "console.log('boot ok');",
                    "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
                    'setInterval(() => {}, 10000);',
                    '',
                ].join('\n'),
            );
            fs.writeFileSync(path.join(projectDir, 'test.js'), "console.log('tests ok');\n");
            return 'code created';
        });

        const command = createBuildCommand({
            configManager: createTestConfigManager(),
            agentFactory: () => ({
                run: agentRun,
            }),
            installDependencies: async () => 'dependencies installed',
            runtimeFactory: () => ({
                start: async () => ({
                    status: RuntimeStatus.Running,
                    projectDir,
                    projectType: ProjectType.Node,
                    packageManager: 'npm',
                    command: 'npm run dev',
                    port: 3000,
                    url: 'http://localhost:3000',
                    errors: [],
                    logs: [],
                    startedAt: new Date(),
                }),
                stop: async () => {},
            }),
            testProject: async () => ({
                status: TestStatus.Passed,
                projectDir,
                packageManager: 'npm',
                command: 'npm run test',
                output: 'Tests 1 passed',
                passed: 1,
                failed: 0,
                skipped: 0,
                failures: [],
                startedAt: new Date(),
                completedAt: new Date(),
            }),
        });

        await command.parseAsync([
            'vite blog',
            '--dir',
            projectDir,
        ], { from: 'user' });

        expect(agentRun).toHaveBeenCalledTimes(2);
        expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, 'server.js'))).toBe(true);
    });

    it('fails fast when the default build agent has no API key', async () => {
        const projectDir = createTempProjectDir();

        await expect(runBuildCommand('vite blog', {
            dir: projectDir,
            model: 'gpt-4o',
        }, {
            configManager: createTestConfigManager(),
        })).rejects.toThrow('LLM API Key 未配置');
    });
});
