import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager, normalizeXQoderConfig, type XQoderConfig } from '@xqoder/shared';
import {
    runAuthLoginCommand,
    runAuthLogoutCommand,
    runListAuthCommand,
} from '../../src/commands/core/auth.js';
import {
    runListModelsCommand,
    runUseModelCommand,
} from '../../src/commands/core/models.js';
import {
    runListAgentsCommand,
    runSetAgentCommand,
    runShowAgentCommand,
    runUseAgentCommand,
} from '../../src/commands/core/agent.js';
import { runStatsCommand } from '../../src/commands/sessions/stats.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('auth command surface', () => {
    it('stores credentials in the local credential file and reflects them in auth list output', () => {
        const manager = createConfigManager();

        runAuthLoginCommand('openai', {
            apiKey: 'sk-test-123',
        }, manager);

        const credentialPath = path.join(path.dirname(manager.getConfigPath()), 'credentials', 'openai.key');
        const listOutput: string[] = [];
        const summaries = runListAuthCommand(
            { json: false },
            { writeOutput: (output) => listOutput.push(output) },
            manager,
        );

        expect(fs.readFileSync(credentialPath, 'utf-8')).toBe('sk-test-123');
        expect(summaries.find((entry) => entry.provider === 'openai')?.authenticated).toBe(true);
        expect(listOutput.join('\n')).toContain('authenticated=yes');

        runAuthLogoutCommand('openai', manager);

        const savedConfig = JSON.parse(fs.readFileSync(manager.getConfigPath(), 'utf-8'));
        expect(fs.existsSync(credentialPath)).toBe(false);
        expect(savedConfig.providers.openai.apiKey).toBe('');
    });

    it('rejects unsupported providers', () => {
        expect(() => runAuthLoginCommand('unsupported', {
            apiKey: 'sk-test-123',
        }, createConfigManager())).toThrow('Unsupported provider: unsupported');
    });
});

describe('models command surface', () => {
    it('switches agent and small-model selections and exposes them in the catalog', () => {
        const manager = createConfigManager({
            providers: {
                anthropic: {
                    defaultModel: 'claude-3-5-sonnet-latest',
                    apiKey: 'anthropic-key',
                },
            },
        });

        runUseModelCommand('claude-sonnet-4', {
            provider: 'anthropic',
            agent: 'reviewer',
        }, manager);
        runUseModelCommand('gpt-4.1-mini', {
            provider: 'openai',
            small: true,
        }, manager);

        const reloaded = manager.load({ mode: 'single' });
        const catalog = runListModelsCommand({ all: true }, {}, manager);

        expect(reloaded.agents?.reviewer?.provider).toBe('anthropic');
        expect(reloaded.agents?.reviewer?.model).toBe('claude-sonnet-4');
        expect(reloaded.smallModel).toEqual({
            provider: 'openai',
            model: 'gpt-4.1-mini',
        });
        expect(catalog.find((entry) => entry.model === 'claude-sonnet-4' && entry.provider === 'anthropic')?.flags)
            .toContain('agent:reviewer');
        expect(catalog.find((entry) => entry.model === 'gpt-4.1-mini' && entry.provider === 'openai')?.small)
            .toBe(true);
    });

    it('rejects empty model names', () => {
        expect(() => runUseModelCommand('   ', {}, createConfigManager())).toThrow('Model name cannot be empty');
    });
});

describe('agent command surface', () => {
    it('saves, lists, shows, and switches a custom agent configuration', () => {
        const manager = createConfigManager({
            providers: {
                anthropic: {
                    defaultModel: 'claude-sonnet-4',
                    apiKey: 'anthropic-key',
                },
            },
        });
        const output: string[] = [];

        runSetAgentCommand('reviewer', {
            mode: 'subagent',
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            instruction: ['focus on regressions'],
            tool: ['read_file'],
            enable: true,
        }, {}, manager);
        runUseAgentCommand('reviewer', {}, manager);

        const agents = runListAgentsCommand({}, {
            writeOutput: (line) => output.push(line),
        }, manager);
        const detail = runShowAgentCommand('reviewer', { json: true }, {
            writeOutput: () => {},
        }, manager);

        expect(agents.find((agent) => agent.name === 'reviewer')).toMatchObject({
            name: 'reviewer',
            default: true,
            provider: 'anthropic',
            model: 'claude-sonnet-4',
        });
        expect(detail).toMatchObject({
            name: 'reviewer',
            default: true,
            source: 'custom',
        });
        expect(output.join('\n')).toContain('reviewer');
    });

    it('fails when a requested agent does not exist', () => {
        expect(() => runShowAgentCommand('missing-agent', {}, {}, createConfigManager()))
            .toThrow('Agent not found: missing-agent');
    });
});

describe('stats command surface', () => {
    it('aggregates project-scoped stats and emits JSON output', () => {
        const outputs: string[] = [];
        const report = runStatsCommand({
            dir: '/workspace/demo',
            json: true,
            days: '7',
        }, {
            writeOutput: (output) => outputs.push(output),
            sessionStore: {
                listSessions: () => [
                    createSessionSummary({
                        id: 'recent-demo',
                        projectRoot: '/workspace/demo',
                        model: 'gpt-4.1',
                        updatedAt: new Date(),
                        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                    }),
                    createSessionSummary({
                        id: 'old-demo',
                        projectRoot: '/workspace/demo',
                        model: 'gpt-4.1-mini',
                        updatedAt: new Date('2000-01-01T00:00:00.000Z'),
                        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
                    }),
                ],
            },
        });

        expect(report.sessionCount).toBe(1);
        expect(report.scope.projectRoot).toBe('/workspace/demo');
        expect(JSON.parse(outputs[0] ?? '{}').sessionCount).toBe(1);
    });

    it('rejects invalid numeric filters', () => {
        expect(() => runStatsCommand({
            dir: '/workspace/demo',
            days: '0',
        }, {
            sessionStore: {
                listSessions: () => [],
            },
        })).toThrow('days must be a positive integer');
    });
});

function createConfigManager(overrides: Partial<XQoderConfig> = {}): ConfigManager {
    const homeDir = createTempDir();
    const configPath = path.join(homeDir, '.xqoder', 'config.json');
    const manager = new ConfigManager({ configPath, homeDir });
    manager.load({ mode: 'single' });
    manager.set(normalizeXQoderConfig({
        ...manager.get(),
        ...overrides,
    }));
    manager.save();
    return manager;
}

function createSessionSummary(input: {
    id: string;
    projectRoot: string;
    model: string;
    updatedAt: Date;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}) {
    return {
        id: input.id,
        projectRoot: input.projectRoot,
        cwd: input.projectRoot,
        model: input.model,
        title: input.id,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
        maxMessages: 64,
        messageCount: 3,
        usage: input.usage,
        compactionCount: 0,
        commandCount: 1,
        fileChangeCount: 0,
    };
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-command-surface-'));
    tempDirs.push(dir);
    return dir;
}
