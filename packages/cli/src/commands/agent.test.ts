import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '@xqoder/shared';
import {
    createAgentCommand,
    runListAgentsCommand,
    runShowAgentCommand,
} from './agent.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-agent-'));
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

describe('agent command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('creates, uses, and removes custom agents', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createAgentCommand(manager);

        await command.parseAsync([
            'set',
            'reviewer',
            '--mode',
            'subagent',
            '--provider',
            'anthropic',
            '--model',
            'claude-sonnet-4',
            '--instruction',
            'focus on bugs',
            '--tool',
            'read_file',
            '--permission-mode',
            'ask',
            '--cwd',
            '/workspace/demo',
            '--use-small-model',
        ], { from: 'user' });

        expect(manager.load({ mode: 'single' }).agents?.reviewer).toEqual({
            mode: 'subagent',
            provider: 'anthropic',
            model: 'claude-sonnet-4',
            prompt: undefined,
            instructions: ['focus on bugs'],
            tools: ['read_file'],
            cwd: '/workspace/demo',
            permissionMode: 'ask',
            disabled: false,
            useSmallModel: true,
            maxTokens: undefined,
            temperature: undefined,
        });

        await command.parseAsync([
            'use',
            'reviewer',
        ], { from: 'user' });
        expect(manager.load({ mode: 'single' }).defaultAgent).toBe('reviewer');

        await command.parseAsync([
            'remove',
            'reviewer',
        ], { from: 'user' });
        expect(manager.load({ mode: 'single' }).agents?.reviewer).toBeUndefined();
        expect(manager.load({ mode: 'single' }).defaultAgent).toBe('general');
    });

    it('lists and shows built-in plus custom agents', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            defaultAgent: 'coder',
            providers: {
                anthropic: {
                    apiKey: 'anthropic-key',
                    defaultModel: 'claude-sonnet-4',
                },
            },
            agents: {
                coder: {
                    mode: 'primary',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
                reviewer: {
                    mode: 'subagent',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
            },
        });
        manager.save();

        const listed = runListAgentsCommand({}, {}, manager);
        const shown = runShowAgentCommand('reviewer', {}, {}, manager);

        expect(listed).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'coder',
                default: true,
                source: 'built-in+custom',
            }),
            expect.objectContaining({
                name: 'reviewer',
                source: 'custom',
                provider: 'anthropic',
            }),
        ]));
        expect(shown).toMatchObject({
            name: 'reviewer',
            source: 'custom',
            runtime: {
                name: 'reviewer',
                llmConfig: {
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
            },
        });
    });
});
