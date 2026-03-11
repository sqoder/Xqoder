import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigManager, normalizeLLMConfig } from '@xqoder/shared';
import {
    createModelsCommand,
    runListModelsCommand,
} from './models.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-models-'));
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

describe('models command', () => {
    it('lists current agent and small-model selections', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            llm: normalizeLLMConfig({
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'openai-key',
            }),
            providers: {
                openai: {
                    apiKey: 'openai-key',
                    defaultModel: 'gpt-4.1',
                },
                anthropic: {
                    apiKey: 'anthropic-key',
                    defaultModel: 'claude-sonnet-4',
                },
            },
            defaultAgent: 'coder',
            smallModel: {
                provider: 'openai',
                model: 'gpt-4.1-mini',
            },
            agents: {
                coder: {
                    mode: 'primary',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
                summary: {
                    mode: 'subagent',
                    provider: 'openai',
                    model: 'gpt-4.1-mini',
                    useSmallModel: true,
                },
            },
        });
        manager.save();

        const entries = runListModelsCommand({
            json: true,
        }, {}, manager);

        expect(entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'anthropic',
                model: 'claude-sonnet-4',
                current: true,
                flags: expect.arrayContaining(['provider-default', 'agent:coder']),
            }),
            expect.objectContaining({
                provider: 'openai',
                model: 'gpt-4.1-mini',
                small: true,
                flags: expect.arrayContaining(['small-model', 'agent:summary']),
            }),
        ]));
    });

    it('switches the default agent model and the small model', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createModelsCommand(manager);

        await command.parseAsync([
            'use',
            'claude-sonnet-4',
            '--provider',
            'anthropic',
        ], { from: 'user' });

        expect(manager.load({ mode: 'single' })).toMatchObject({
            defaultAgent: 'general',
            providers: {
                anthropic: {
                    defaultModel: 'claude-sonnet-4',
                },
            },
            agents: {
                general: {
                    provider: 'anthropic',
                    model: 'claude-sonnet-4',
                },
            },
        });

        await command.parseAsync([
            'use',
            'gpt-4.1-mini',
            '--provider',
            'openai',
            '--small',
        ], { from: 'user' });

        expect(manager.load({ mode: 'single' }).smallModel).toEqual({
            provider: 'openai',
            model: 'gpt-4.1-mini',
        });
    });
});
