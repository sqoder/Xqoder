import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigManager } from '@xqoder/shared';
import { createAuthCommand, runAuthLoginCommand, runAuthLogoutCommand, runListAuthCommand } from './auth.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-auth-'));
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

describe('auth command', () => {
    it('logs in and logs out a provider credential', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createAuthCommand(manager);

        await command.parseAsync([
            'login',
            'anthropic',
            '--api-key',
            'anthropic-key',
            '--default-model',
            'claude-sonnet-4',
            '--base-url',
            'https://example.com/anthropic',
        ], { from: 'user' });

        expect(manager.load({ mode: 'single' })).toMatchObject({
            providers: {
                anthropic: {
                    apiKey: 'anthropic-key',
                    defaultModel: 'claude-sonnet-4',
                    baseUrl: 'https://example.com/anthropic',
                    disabled: false,
                },
            },
        });

        await command.parseAsync([
            'logout',
            'anthropic',
        ], { from: 'user' });

        expect(manager.load({ mode: 'single' }).providers?.anthropic).toMatchObject({
            apiKey: '',
            defaultModel: 'claude-sonnet-4',
            baseUrl: 'https://example.com/anthropic',
            disabled: false,
        });
    });

    it('lists stored provider auth status', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            providers: {
                openai: {
                    apiKey: 'openai-key',
                    defaultModel: 'gpt-4.1',
                },
                anthropic: {
                    apiKey: '',
                    defaultModel: 'claude-sonnet-4',
                    disabled: true,
                },
            },
        });
        manager.save();

        const lines: string[] = [];
        runListAuthCommand({ all: false }, {
            writeOutput: (output) => {
                lines.push(output);
            },
        }, manager);

        expect(lines).toEqual(expect.arrayContaining([
            expect.stringContaining('openai'),
            expect.stringContaining('authenticated=yes'),
            expect.stringContaining('anthropic'),
            expect.stringContaining('authenticated=no'),
            expect.stringContaining('disabled=yes'),
        ]));
    });

    it('persists provider apiKey to disk so a fresh load sees authenticated=yes', () => {
        const configPath = createTempConfigPath();
        const manager = new ConfigManager(configPath);
        runAuthLoginCommand('openai', { apiKey: 'openai-secret' }, manager);
        const fresh = new ConfigManager(configPath).load({ mode: 'single' });
        expect(fresh.providers?.openai?.apiKey).toBe('openai-secret');
        const summaries = runListAuthCommand({}, {}, { load: () => fresh } as Parameters<typeof runListAuthCommand>[2]);
        expect(summaries.find((s) => s.provider === 'openai')?.authenticated).toBe(true);

        runAuthLogoutCommand('openai', manager);
        const afterLogout = new ConfigManager(configPath).load({ mode: 'single' });
        expect(afterLogout.providers?.openai?.apiKey).toBe('');
        const summariesAfter = runListAuthCommand({}, {}, { load: () => afterLogout } as Parameters<typeof runListAuthCommand>[2]);
        expect(summariesAfter.find((s) => s.provider === 'openai')?.authenticated).toBe(false);
    });
});
