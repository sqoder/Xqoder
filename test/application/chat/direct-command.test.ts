import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import {
    buildConversationTurnInput,
    prepareChatExecution,
    resolveDirectChatCommandResponse,
} from '../../../src/application/chat/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('direct chat commands', () => {
    it('returns a stable no-session message for /compact when there is no active session', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/compact',
                cwd,
                startNewSession: true,
                entrypoint: 'headless',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );

        await expect(resolveDirectChatCommandResponse(execution)).resolves.toBe('No active session to compact.');
    });

    it('uses the shared direct-command compaction path when an active session is available', async () => {
        const cwd = createTempDir();
        const session = new AgentSession({
            id: 'compact-session',
            systemPrompt: 'system',
        });
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/compact',
                cwd,
                sessionId: session.id,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    saveSession: () => ({ id: session.id }),
                },
            },
        );

        const response = await resolveDirectChatCommandResponse(execution, {
            compactSession: async () => 'Compacted summary',
        });

        expect(response).toBe('Compacted summary');
    });

    it('formats /tools output from the shared visible-tool catalog', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/tools',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );

        const response = await resolveDirectChatCommandResponse(execution, {
            listVisibleTools: async () => ([
                { name: 'read_file', description: 'Read file content', permissionMode: 'allow' },
                { name: 'run_shell', description: 'Execute shell commands', permissionMode: 'deny' },
            ]),
        });

        expect(response).toBe([
            'Visible tools for this turn:',
            '- read_file (allow) - Read file content',
            '- run_shell (deny) - Execute shell commands',
        ].join('\n'));
    });
});

function createLoadedConfig(
    apiKey: string,
) {
    return {
        llm: {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey,
        },
        providers: {
            openai: {
                apiKey,
                defaultModel: 'gpt-4.1',
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider: 'openai',
                model: 'gpt-4.1',
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
    };
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-direct-command-'));
    tempDirs.push(dir);
    return dir;
}
