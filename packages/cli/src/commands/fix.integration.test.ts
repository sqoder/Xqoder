import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixCommand, runFixCommand } from './fix.js';
import {
    cleanupTempProjects,
    createIntegrationRuntime,
    createTempProjectFromFixture,
    type FixFixtureName,
} from './fix.e2e-utils.js';

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

afterEach(() => {
    cleanupTempProjects();
});

describe('xqoder fix integration', () => {
    const cases: Array<{
        fixture: FixFixtureName;
        description: string;
        repair(projectDir: string): string;
        assert(projectDir: string): void;
    }> = [
        {
            fixture: 'missing-local-module',
            description: 'repairs a missing local module fixture end-to-end',
            repair(projectDir) {
                fs.writeFileSync(
                    path.join(projectDir, 'message.js'),
                    "exports.getMessage = () => 'fixture repaired';\n",
                );
                return 'created message.js';
            },
            assert(projectDir) {
                expect(fs.existsSync(path.join(projectDir, 'message.js'))).toBe(true);
            },
        },
        {
            fixture: 'syntax-error',
            description: 'repairs a syntax error fixture end-to-end',
            repair(projectDir) {
                fs.writeFileSync(
                    path.join(projectDir, 'server.js'),
                    [
                        "console.log('boot ok');",
                        "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
                        'setInterval(() => {}, 10000);',
                        '',
                    ].join('\n'),
                );
                return 'rewrote server.js';
            },
            assert(projectDir) {
                expect(fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8')).toContain('Local: http://localhost:');
            },
        },
        {
            fixture: 'missing-script',
            description: 'repairs a missing nested script fixture end-to-end',
            repair(projectDir) {
                const packageJsonPath = path.join(projectDir, 'package.json');
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
                    scripts?: Record<string, string>;
                };
                packageJson.scripts = {
                    ...(packageJson.scripts ?? {}),
                    dev: 'node server.js',
                };
                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
                return 'rewrote dev script';
            },
            assert(projectDir) {
                const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8')) as {
                    scripts?: Record<string, string>;
                };
                expect(packageJson.scripts?.['dev']).toBe('node server.js');
            },
        },
        {
            fixture: 'port-conflict',
            description: 'repairs a simulated port conflict fixture end-to-end',
            repair(projectDir) {
                fs.writeFileSync(
                    path.join(projectDir, 'server.js'),
                    [
                        "console.log('boot ok');",
                        "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
                        'setInterval(() => {}, 10000);',
                        '',
                    ].join('\n'),
                );
                return 'removed port conflict simulation';
            },
            assert(projectDir) {
                expect(fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8')).toContain('Local: http://localhost:');
            },
        },
        {
            fixture: 'next-missing-env',
            description: 'repairs a missing environment variable fixture end-to-end',
            repair(projectDir) {
                fs.writeFileSync(
                    path.join(projectDir, 'server.js'),
                    [
                        "const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';",
                        "console.log(`Using API: ${apiBaseUrl}`);",
                        "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
                        'setInterval(() => {}, 10000);',
                        '',
                    ].join('\n'),
                );
                return 'added env fallback';
            },
            assert(projectDir) {
                const server = fs.readFileSync(path.join(projectDir, 'server.js'), 'utf-8');
                expect(server).toContain('API_BASE_URL');
                expect(server).toContain("http://localhost:4000");
            },
        },
        {
            fixture: 'vite-typescript-error',
            description: 'repairs a TypeScript compile error fixture end-to-end',
            repair(projectDir) {
                fs.writeFileSync(
                    path.join(projectDir, 'src', 'main.ts'),
                    [
                        'const count: number = 1;',
                        "console.log('count', count);",
                        '',
                    ].join('\n'),
                );
                return 'fixed TypeScript assignment';
            },
            assert(projectDir) {
                const source = fs.readFileSync(path.join(projectDir, 'src', 'main.ts'), 'utf-8');
                expect(source).toContain('const count: number = 1;');
            },
        },
    ];

    for (const testCase of cases) {
        it(testCase.description, async () => {
            const projectDir = createTempProjectFromFixture(testCase.fixture);
            const repairProject = vi.fn(async ({ projectConfig }) => {
                return testCase.repair(projectConfig.rootDir);
            });

            const command = createFixCommand({
                configManager: createTestConfigManager(),
                runtimeFactory: () => createIntegrationRuntime(),
                repairProject: async (input) => repairProject(input),
            });

            await command.parseAsync([
                '--dir',
                projectDir,
                '--max-attempts',
                '2',
            ], { from: 'user' });

            expect(repairProject).toHaveBeenCalledTimes(1);
            testCase.assert(projectDir);
        }, 10000);
    }

    it('fails fast when the default agent has no API key', async () => {
        await expect(runFixCommand({
            dir: '.',
            model: 'gpt-4o',
            maxAttempts: 1,
        }, {
            configManager: createTestConfigManager(),
            runtimeFactory: () => createIntegrationRuntime(),
        })).rejects.toThrow('LLM API Key 未配置');
    });
});
