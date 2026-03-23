import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixCommand, runFixCommand } from './fix.js';
import {
    getProjectPermissionAuditLogPath,
    getProjectPermissionsFilePath,
    RuntimeErrorType,
} from '@xqoder/shared';
import type { WorkflowRunRecord } from '../services/workflow-history.js';
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
            const workflowHistoryStore = {
                append: vi.fn(),
            };
            const repairProject = vi.fn(async ({ projectConfig }) => {
                return testCase.repair(projectConfig.rootDir);
            });

            const command = createFixCommand({
                configManager: createTestConfigManager(),
                workflowHistoryStore,
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
            expect(workflowHistoryStore.append).toHaveBeenCalledWith(expect.objectContaining({
                flow: 'fix',
                projectRoot: projectDir,
            }));
            testCase.assert(projectDir);
        }, 10000);
    }

    it('promotes and executes safe automatic remediation based on workflow history evidence', async () => {
        const missingPackageName = 'xqoder-auto-promotion-missing-package';
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-fix-auto-promotion-'));
        const packageJsonPath = path.join(projectDir, 'package.json');
        const serverPath = path.join(projectDir, 'server.js');
        fs.writeFileSync(packageJsonPath, JSON.stringify({
            name: 'xqoder-fix-auto-promotion',
            private: true,
            scripts: {
                dev: 'node server.js',
            },
        }, null, 2), 'utf8');
        fs.writeFileSync(serverPath, [
            `require('${missingPackageName}');`,
            "console.log(`Local: http://localhost:${process.env.PORT || 3000}`);",
            'setInterval(() => {}, 10000);',
            '',
        ].join('\n'), 'utf8');

        const workflowHistoryStore = {
            append: vi.fn(),
            list: vi.fn((): WorkflowRunRecord[] => ([
                {
                    id: 'history_fix_1',
                    flow: 'fix',
                    projectRoot: projectDir,
                    projectName: path.basename(projectDir),
                    userRequest: 'fix dependency',
                    status: 'completed',
                    success: true,
                    startedAt: '2026-03-19T00:00:00.000Z',
                    completedAt: '2026-03-19T00:01:00.000Z',
                    totalDurationMs: 60000,
                    automaticActionIds: ['auto-install-dependency-v1'],
                    suspectedFailureBuckets: ['runtime_dependency_missing'],
                },
                {
                    id: 'history_fix_2',
                    flow: 'fix',
                    projectRoot: projectDir,
                    projectName: path.basename(projectDir),
                    userRequest: 'fix dependency again',
                    status: 'completed',
                    success: true,
                    startedAt: '2026-03-20T00:00:00.000Z',
                    completedAt: '2026-03-20T00:01:00.000Z',
                    totalDurationMs: 60000,
                    automaticActionIds: ['auto-install-dependency-v1'],
                    suspectedFailureBuckets: ['runtime_dependency_missing'],
                },
                {
                    id: 'history_fix_3',
                    flow: 'fix',
                    projectRoot: projectDir,
                    projectName: path.basename(projectDir),
                    userRequest: 'fix dependency third',
                    status: 'completed',
                    success: true,
                    startedAt: '2026-03-21T00:00:00.000Z',
                    completedAt: '2026-03-21T00:01:00.000Z',
                    totalDurationMs: 60000,
                    automaticActionIds: ['auto-install-dependency-v1'],
                    suspectedFailureBuckets: ['runtime_dependency_missing'],
                },
            ])),
        };
        const runSafeCommand = vi.fn(async () => {
            const moduleFile = path.join(projectDir, 'node_modules', missingPackageName, 'index.js');
            fs.mkdirSync(path.dirname(moduleFile), { recursive: true });
            fs.writeFileSync(moduleFile, 'module.exports = {};\n', 'utf8');
            return `installed ${missingPackageName}`;
        });
        const repairProject = vi.fn(async (_input: unknown) => 'agent should not run');

        try {
            const command = createFixCommand({
                configManager: createTestConfigManager(),
                workflowHistoryStore,
                runtimeFactory: () => {
                    const runtime = createIntegrationRuntime();
                    return {
                        async start(rootDir: string) {
                            const report = await runtime.start(rootDir);
                            const missingDependencyMessage = `Cannot find module '${missingPackageName}'`;
                            if (report.errors.some((entry) => entry.message.includes(missingDependencyMessage))) {
                                report.errors = report.errors.map((entry) => (
                                    entry.message.includes(missingDependencyMessage)
                                        ? {
                                            ...entry,
                                            type: RuntimeErrorType.DependencyMissing,
                                        }
                                        : entry
                                ));
                            }
                            return report;
                        },
                        analyzeErrors: runtime.analyzeErrors,
                        stop: runtime.stop,
                    };
                },
                runSafeCommand,
                repairProject: async (input) => repairProject(input),
            });

            await command.parseAsync([
                '--dir',
                projectDir,
                '--max-attempts',
                '2',
            ], { from: 'user' });

            expect(runSafeCommand).toHaveBeenCalledTimes(1);
            expect(repairProject).not.toHaveBeenCalled();
            expect(workflowHistoryStore.append).toHaveBeenCalledWith(expect.objectContaining({
                flow: 'fix',
                success: true,
                automaticActionIds: ['auto-install-dependency-v1'],
                suspectedFailureBuckets: ['runtime_dependency_missing'],
            }));

            const permissionFile = JSON.parse(fs.readFileSync(getProjectPermissionsFilePath(projectDir), 'utf8')) as {
                automaticActionPromotions: Array<{ actionId: string; bucket: string }>;
            };
            expect(permissionFile.automaticActionPromotions).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    actionId: 'auto-install-dependency-v1',
                    bucket: 'runtime_dependency_missing',
                }),
            ]));

            const auditEntries = fs.readFileSync(getProjectPermissionAuditLogPath(projectDir), 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as { kind: string; decision: string; actionId?: string; bucket?: string });
            expect(auditEntries).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    kind: 'automatic-action.promotion',
                    decision: 'allow',
                    actionId: 'auto-install-dependency-v1',
                    bucket: 'runtime_dependency_missing',
                }),
                expect.objectContaining({
                    kind: 'automatic-action.execution',
                    decision: 'allow',
                    actionId: 'auto-install-dependency-v1',
                    bucket: 'runtime_dependency_missing',
                }),
            ]));
        } finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    }, 12000);

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
