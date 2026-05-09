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

    it('returns a help summary listing every routed slash command', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/help',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('/status');
        expect(response).toContain('/doctor');
        expect(response).toContain('/cost');
        expect(response).toContain('/agents');
        expect(response).toContain('/mcp');
        expect(response).toContain('/memory');
        expect(response).toContain('/model');
        expect(response).toContain('/help');
    });

    it('exposes the primary model configuration for /model', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/model',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('primary.provider=openai');
        expect(response).toContain('primary.model=gpt-4.1');
        expect(response).toContain('activeAgent=general');
    });

    it('reports zero-usage when the session has not consumed tokens for /cost', async () => {
        const cwd = createTempDir();
        const session = new AgentSession({
            id: 'cost-zero',
            systemPrompt: 'system',
        });
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/cost',
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
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('cost-zero');
        expect(response).toContain('has not consumed any tokens');
    });

    it('surfaces the project notepad snapshot for /memory when the file exists', async () => {
        const cwd = createTempDir();
        const notepadDir = path.join(cwd, '.xqoder');
        fs.mkdirSync(notepadDir, { recursive: true });
        fs.writeFileSync(path.join(notepadDir, 'notepad.md'), [
            '## PRIORITY',
            '',
            'Ship slice-12.',
            '',
            '## WORKING MEMORY',
            '',
            '[2026-05-09T00:00:00.000Z] Drafted direct-command handlers.',
            '',
            '## MANUAL',
            '',
            '- Remember to write tests.',
            '',
        ].join('\n'));

        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/memory',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('Notepad:');
        expect(response).toContain('Ship slice-12.');
        expect(response).toContain('Drafted direct-command handlers.');
    });

    it('returns a helpful empty-state for /memory when no notepad exists', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/memory',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('No project notepad');
        expect(response).toContain('notepad write-working');
    });

    it('lists built-in and configured agents for /agents', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/agents',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('Agents (default:');
        // "general" is configured in the test config
        expect(response).toContain('general');
    });

    it('returns a no-servers message for /mcp when none are configured', async () => {
        const cwd = createTempDir();
        const execution = prepareChatExecution(
            buildConversationTurnInput({
                prompt: '/mcp',
                cwd,
                entrypoint: 'cli',
            }),
            {
                configManager: { load: () => createLoadedConfig('test-key') },
            },
        );
        const response = await resolveDirectChatCommandResponse(execution);
        expect(response).toContain('No MCP servers configured');
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
