import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    createConfigDoctorReport,
} from '../../../src/application/config/service.js';
import { MISSING_API_KEY_GUIDANCE } from '../../../src/application/config/api-key-guidance.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('config doctor report', () => {
    it('surfaces the current auth/model guidance when the api key is missing', async () => {
        const manager = createManager();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const apiKeyCheck = report.checks.find((check) => check.name === 'LLM API key');

        expect(report.ok).toBe(false);
        expect(apiKeyCheck).toMatchObject({
            status: 'error',
            message: MISSING_API_KEY_GUIDANCE,
        });
    });

    it('marks the api key check as configured when XQODER_LLM_API_KEY is provided', async () => {
        const manager = createManager();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            env: {
                ...process.env,
                XQODER_LLM_API_KEY: 'env-key',
            },
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const apiKeyCheck = report.checks.find((check) => check.name === 'LLM API key');

        expect(report.ok).toBe(true);
        expect(report.appliedEnvVars).toContain('XQODER_LLM_API_KEY');
        expect(apiKeyCheck).toMatchObject({
            status: 'ok',
            message: 'Configured (env)',
        });
    });


    it('reports that macOS system proxy will be auto-inherited for remote providers', async () => {
        const manager = createManager();
        manager.set({
            ...manager.get(),
            llm: {
                ...manager.get().llm,
                provider: 'dashscope',
                model: 'qwen-plus',
                apiKey: 'dashscope-key',
                baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
            providers: {
                ...(manager.get().providers ?? {}),
                dashscope: {
                    apiKey: 'dashscope-key',
                    defaultModel: 'qwen-plus',
                    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                    maxTokens: 4096,
                    temperature: 0.1,
                    disabled: false,
                },
            },
        });
        manager.save();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            env: {},
            hasExecutable: () => true,
            systemProxyReader: () => 'http://127.0.0.1:7890',
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const networkCheck = report.checks.find((check) => check.name === 'Provider network');

        expect(networkCheck).toMatchObject({
            status: 'ok',
            message: 'Proxy system will be used for dashscope: http://127.0.0.1:7890',
        });
    });

    it('does not require an api key when the active provider is local', async () => {
        const manager = createManager();
        manager.set({
            ...manager.get(),
            llm: {
                ...manager.get().llm,
                provider: 'local',
                model: 'qwen3:8b',
                apiKey: '',
                baseUrl: 'http://localhost:11434/v1',
            },
            providers: {
                ...(manager.get().providers ?? {}),
                local: {
                    apiKey: '',
                    defaultModel: 'qwen3:8b',
                    baseUrl: 'http://localhost:11434/v1',
                    maxTokens: 4096,
                    temperature: 0.1,
                    disabled: false,
                },
            },
            agents: {
                ...(manager.get().agents ?? {}),
                general: {
                    ...(manager.get().agents?.general ?? {}),
                    provider: 'local',
                    model: 'qwen3:8b',
                },
            },
        });
        manager.save();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const apiKeyCheck = report.checks.find((check) => check.name === 'LLM API key');

        expect(apiKeyCheck).toMatchObject({
            status: 'ok',
            message: 'Not required for provider: local',
        });
    });

    it('does not suggest removed lsp CLI commands when no lsp servers are configured', async () => {
        const manager = createManager();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const lspCheck = report.checks.find((check) => check.name === 'LSP servers');

        expect(lspCheck?.message).toBe(
            'No LSP server enabled. Configure lsp.servers in config for multi-language code understanding.',
        );
        expect(lspCheck?.message).not.toContain('xqoder lsp');
    });

    it('describes configured lsp servers without pointing to removed lsp CLI commands', async () => {
        const manager = createManager();
        manager.set({
            ...manager.get(),
            lsp: {
                servers: [{
                    name: 'typescript',
                    extensions: ['ts', 'tsx'],
                    command: 'typescript-language-server',
                    args: ['--stdio'],
                    enabled: true,
                }],
            },
        });
        manager.save();

        const report = await createConfigDoctorReport(manager, {
            cwd: createTempDir(),
            hasExecutable: () => true,
            discoverPlugins: async () => ({ commands: [], report: [] }),
        });

        const lspCheck = report.checks.find((check) => check.name === 'LSP servers');

        expect(lspCheck?.message).toBe(
            '1 LSP server(s) enabled from config lsp.servers; agent runtime will use them for code intelligence',
        );
        expect(lspCheck?.message).not.toContain('xqoder lsp');
    });
});

function createManager(): ConfigManager {
    const homeDir = createTempDir();
    const configPath = path.join(homeDir, '.xqoder', 'config.json');
    const manager = new ConfigManager({ configPath, homeDir });
    manager.load({ mode: 'single' });
    return manager;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-config-doctor-'));
    tempDirs.push(dir);
    return dir;
}
