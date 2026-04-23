import { describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/storage-sqlite';
import {
    runListSessionsCommand,
    runShowSessionCommand,
} from '../../src/commands/sessions/sessions.js';

describe('session command surface usage visibility', () => {
    it('includes usage in list --format json output', () => {
        const summary = createSummary();
        const output = captureConsoleLog(() => {
            runListSessionsCommand({
                dir: '/workspace/demo',
                limit: '10',
                maxCount: '10',
                format: 'json',
            }, {
                sessionStore: {
                    listSessions: () => [summary],
                } as any,
            });
        });

        expect(JSON.parse(output[0] ?? '[]')).toEqual([{
            id: 'session-command-usage',
            title: 'Command Usage',
            projectRoot: '/workspace/demo',
            updatedAt: '2026-04-20T08:05:00.000Z',
            model: 'openai/gpt-4.1',
            messageCount: 2,
            usage: {
                promptTokens: 21,
                completionTokens: 5,
                totalTokens: 26,
                cacheReadTokens: 8,
                cacheCreationTokens: 3,
                cost: 0.45,
            },
            totalTokens: 26,
        }]);
    });

    it('includes usage in session show output', () => {
        const session = createSession();
        const summary = createSummary();

        const output = captureConsoleLog(() => {
            runShowSessionCommand(undefined, {
                dir: '/workspace/demo',
                transcriptLimit: '6',
                historyLimit: '4',
            }, {
                sessionStore: {
                    findLatestSession: () => session,
                    getSession: () => session,
                    getSessionSummary: () => summary,
                } as any,
            });
        });

        expect(output.join('\n')).toContain(
            'Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45',
        );
        expect(output.join('\n')).toContain('[verification:ok] Verification passed: session detail carries usage');
    });
});

function createSession(): AgentSession {
    const session = new AgentSession({
        id: 'session-command-usage',
        title: 'Command Usage',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        maxMessages: 64,
    });
    session.addUserMessage('show session usage');
    session.recordToolExecution({
        id: 'tool-session-1',
        name: 'write_file',
        args: { path: 'src/session-output.ts' },
        success: true,
        output: 'patched session detail output',
    });
    session.addToolResult('tool-session-1', 'patched session detail output');
    session.addMessage({
        role: 'system',
        content: 'Verification passed: session detail carries usage',
    });
    session.recordVerification({
        ok: true,
        blocked: false,
        summary: 'Verification passed: session detail carries usage',
        messages: ['Verification passed: session detail carries usage'],
    });
    session.addAssistantMessage({ role: 'assistant', content: 'usage is visible' });
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

function createSummary() {
    return {
        id: 'session-command-usage',
        projectRoot: '/workspace/demo',
        cwd: '/workspace/demo',
        model: 'openai/gpt-4.1',
        title: 'Command Usage',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
        maxMessages: 64,
        messageCount: 2,
        usage: {
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        },
        lastUserMessage: 'show session usage',
        compactionCount: 0,
        commandCount: 0,
        fileChangeCount: 0,
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
