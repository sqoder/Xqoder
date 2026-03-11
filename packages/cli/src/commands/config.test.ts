import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigManager } from '@xqoder/shared';
import {
    createConfigCommand,
    createConfigDoctorReport,
    createConfigShowSnapshot,
} from './config.js';
import {
    runConfigInit,
    runConfigShow,
    runConfigDoctor,
} from '../services/config-service.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-config-'));
    tempDirs.push(dir);
    return path.join(dir, 'config.json');
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('config command', () => {
    it('writes the selected provider configuration and vercel scope', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createConfigCommand(manager);

        await command.parseAsync([
            'init',
            '--provider',
            'anthropic',
            '--model',
            'claude-3-7-sonnet-latest',
            '--api-key',
            'secret-key',
            '--default-deploy-target',
            'vercel',
            '--vercel-scope',
            'my-team',
            '--sandbox-mode',
            'full-access',
            '--debug',
        ], { from: 'user' });

        expect(manager.load()).toMatchObject({
            llm: {
                provider: 'anthropic',
                model: 'claude-3-7-sonnet-latest',
                apiKey: 'secret-key',
            },
            defaultDeployTarget: 'vercel',
            vercel: {
                scope: 'my-team',
            },
            sandbox: {
                mode: 'full-access',
                allowedPaths: [],
            },
            debug: true,
        });
    });

    it('applies DashScope defaults when provider is dashscope', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createConfigCommand(manager);

        await command.parseAsync([
            'init',
            '--provider',
            'dashscope',
            '--api-key',
            'secret-key',
        ], { from: 'user' });

        expect(manager.load()).toMatchObject({
            llm: {
                provider: 'dashscope',
                model: 'qwen-plus',
                apiKey: 'secret-key',
                baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
        });
    });

    it('shows masked effective config with applied env overrides', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            llm: {
                provider: 'openai',
                model: 'gpt-4o',
                apiKey: 'saved-openai-key',
            },
            vercel: {
                scope: 'saved-team',
            },
            lsp: {
                servers: [
                    {
                        name: 'pyright',
                        command: 'pyright-langserver',
                        extensions: ['.py'],
                        env: {
                            TOKEN: 'saved-lsp-token',
                        },
                    },
                ],
            },
        });
        manager.save();

        const snapshot = createConfigShowSnapshot(manager, {
            XQODER_LLM_API_KEY: 'env-secret-key',
            XQODER_VERCEL_SCOPE: 'env-team',
        });

        expect(snapshot.config.llm.apiKey).toBe('env-***-key');
        expect(snapshot.config.vercel?.scope).toBe('env-team');
        expect(snapshot.config.lsp?.servers[0]?.env).toEqual({
            TOKEN: 'save***oken',
        });
        expect(snapshot.appliedEnvVars).toEqual([
            'XQODER_LLM_API_KEY',
            'XQODER_VERCEL_SCOPE',
        ]);
    });

    it('reports doctor warnings and errors for missing credentials and tools', async () => {
        const manager = new ConfigManager(createTempConfigPath());

        const report = await createConfigDoctorReport(manager, {
            env: {},
            hasExecutable: () => false,
            configExists: () => false,
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'LLM API key',
                status: 'error',
            }),
            expect.objectContaining({
                name: 'Vercel token',
                status: 'warn',
            }),
            expect.objectContaining({
                name: 'ripgrep',
                status: 'warn',
            }),
            expect.objectContaining({
                name: 'Sandbox mode',
                status: 'ok',
            }),
            expect.objectContaining({
                name: 'LSP servers',
                status: 'warn',
            }),
        ]));
    });
});

describe('config service (Day 38)', () => {
    it('runConfigInit persists options and runConfigShow returns masked snapshot', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);

        runConfigInit(manager, {
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'sk-secret',
            defaultAgent: 'general',
        });

        expect(manager.load()).toMatchObject({
            llm: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-secret' },
            defaultAgent: 'general',
        });

        const out: string[] = [];
        runConfigShow(manager, { json: true }, { writeOutput: (s) => out.push(s) });
        const snapshot = JSON.parse(out[0]!) as ReturnType<typeof createConfigShowSnapshot>;
        expect(snapshot.config.llm.apiKey).toBe('sk-s***cret');
        expect(snapshot.configPath).toBe(configPath);
    });

    it('runConfigDoctor with json writes report', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const out: string[] = [];
        await runConfigDoctor(manager, { json: true }, {
            env: {},
            hasExecutable: () => false,
            writeOutput: (s) => out.push(s),
        });
        const report = JSON.parse(out[0]!);
        expect(report.ok).toBe(false);
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'LLM API key', status: 'error' }),
        ]));
    });

    it('includes plugin diagnostics in doctor reports', async () => {
        const manager = new ConfigManager(createTempConfigPath());

        const report = await createConfigDoctorReport(manager, {
            env: {},
            hasExecutable: () => true,
            discoverPlugins: async () => ({
                commands: [],
                report: [
                    { name: 'cli-core-shell', status: 'loaded', source: 'built-in' },
                    { name: 'future-plugin', status: 'incompatible', source: 'external', reason: 'version mismatch' },
                ],
            }),
        });

        expect(report.plugins).toEqual([
            { name: 'cli-core-shell', status: 'loaded', source: 'built-in' },
            { name: 'future-plugin', status: 'incompatible', source: 'external', reason: 'version mismatch' },
        ]);
    });
});
