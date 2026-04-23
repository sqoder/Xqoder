import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/storage-sqlite';
import { FileSessionShareStore } from '../../src/features/sessions/assets.js';
import {
    runCreateShareCommand,
    runListSharesCommand,
    runShowShareCommand,
} from '../../src/commands/sessions/share.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('share command surface usage visibility', () => {
    it('persists usage into share records and shows it in list/detail output', () => {
        const shareDir = createTempDir();
        const shareStore = new FileSessionShareStore(shareDir);
        const session = createSession();
        const summary = createSummary(session);

        const share = runCreateShareCommand(undefined, {
            dir: '/workspace/demo',
            format: 'markdown',
        }, {
            sessionStore: {
                findLatestSession: () => session,
                getSession: () => session,
                getSessionSummary: () => summary,
            } as any,
            shareStore,
        });

        expect(share.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(shareStore.getShare(share.id)?.content).toContain('## Conversation Signals');
        expect(shareStore.getShare(share.id)?.content).toContain('[verification:ok] Verification passed: share output includes usage');

        const listOutput = captureConsoleLog(() => {
            runListSharesCommand({
                dir: '/workspace/demo',
                limit: '10',
            }, { shareStore });
        });
        const detailOutput = captureConsoleLog(() => {
            runShowShareCommand(share.id, { shareStore });
        });

        expect(listOutput.join('\n')).toContain('tokens=26');
        expect(listOutput.join('\n')).toContain('cost=$0.45');
        expect(detailOutput.join('\n')).toContain(
            'Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45',
        );
    });
});

function createSession(): AgentSession {
    const session = new AgentSession({
        id: 'session-share-command-usage',
        title: 'Share Command Usage',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        maxMessages: 64,
    });
    session.addUserMessage('share usage');
    session.recordToolExecution({
        id: 'tool-share-1',
        name: 'write_file',
        args: { path: 'src/share.ts' },
        success: true,
        output: 'patched share output',
    });
    session.addToolResult('tool-share-1', 'patched share output');
    session.addMessage({
        role: 'system',
        content: 'Verification passed: share output includes usage',
    });
    session.recordVerification({
        ok: true,
        blocked: false,
        summary: 'Verification passed: share output includes usage',
        messages: ['Verification passed: share output includes usage'],
    });
    session.addAssistantMessage({ role: 'assistant', content: 'usage is visible in share output' });
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
        title: 'Share Command Usage',
        createdAt: new Date('2026-04-20T08:00:00.000Z'),
        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
        maxMessages: 64,
        messageCount: session.getMessages().length,
        usage: session.getUsage(),
        lastUserMessage: 'share usage',
        compactionCount: 0,
        commandCount: session.getCommandHistory().length,
        fileChangeCount: session.getFileChanges().length,
    };
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-share-usage-'));
    tempDirs.push(dir);
    return dir;
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
