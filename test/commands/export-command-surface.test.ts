import { describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/storage-sqlite';
import { runExportCommand } from '../../src/commands/sessions/export.js';

describe('export command surface usage visibility', () => {
    it('emits rich usage fields in JSON export payloads', () => {
        const session = createSession();
        const summary = createSummary(session);
        const output = captureConsoleLog(() => {
            const result = runExportCommand(undefined, {
                dir: '/workspace/demo',
                format: 'json',
            }, {
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    getSessionSummary: () => summary,
                } as any,
            });

            expect(result.document.summary.usage).toMatchObject({
                promptTokens: 21,
                completionTokens: 5,
                totalTokens: 26,
                cacheReadTokens: 8,
                cacheCreationTokens: 3,
                cost: 0.45,
            });
        });

        const parsed = JSON.parse(output[0] ?? '{}');
        expect(parsed.summary.usage).toEqual({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(parsed.snapshot.usage).toEqual({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
    });

    it('emits rich usage lines in markdown export payloads', () => {
        const session = createSession();
        const summary = createSummary(session);
        const output = captureConsoleLog(() => {
            const result = runExportCommand(undefined, {
                dir: '/workspace/demo',
                format: 'markdown',
            }, {
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    getSessionSummary: () => summary,
                } as any,
            });

            expect(result.payload).toContain(
                '- Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45',
            );
        });

        expect(output.join('\n')).toContain(
            '- Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45',
        );
    });
});

function createSession(): AgentSession {
    const session = new AgentSession({
        id: 'session-export-command-usage',
        title: 'Export Command Usage',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        maxMessages: 64,
    });
    session.addUserMessage('export usage');
    session.addAssistantMessage({ role: 'assistant', content: 'usage is visible in export output' });
    session.recordUsage({
        promptTokens: 21,
        completionTokens: 5,
        totalTokens: 26,
        cacheReadTokens: 8,
        cacheCreationTokens: 3,
        cost: 0.45,
    });
    return session;
}

function createSummary(session: AgentSession) {
    return {
        id: session.id,
        projectRoot: '/workspace/demo',
        cwd: '/workspace/demo',
        model: 'openai/gpt-4.1',
        title: 'Export Command Usage',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
        maxMessages: 64,
        messageCount: session.getMessages().length,
        usage: session.getUsage(),
        lastUserMessage: 'export usage',
        compactionCount: 0,
        commandCount: session.getCommandHistory().length,
        fileChangeCount: session.getFileChanges().length,
    };
}

function captureConsoleLog(action: () => void): string[] {
    const original = console.log;
    const output: string[] = [];

    console.log = (...args: unknown[]) => {
        output.push(args.map((value) => String(value)).join(' '));
    };

    try {
        action();
    } finally {
        console.log = original;
    }

    return output;
}
