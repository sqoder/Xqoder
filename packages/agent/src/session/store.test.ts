import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSession } from './session.js';
import { SQLiteSessionStore } from './store.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-store-'));
    tempDirs.push(dir);
    return path.join(dir, 'sessions.sqlite');
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('SQLiteSessionStore', () => {
    it('persists and reloads a complete agent session snapshot', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_demo',
            title: 'Inspect demo project',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            maxMessages: 6,
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '帮我看下这个项目' },
                { role: 'assistant', content: '先看一下结构。' },
                { role: 'tool', content: 'README.md', toolCallId: 'tool_1' },
            ],
            usage: {
                promptTokens: 120,
                completionTokens: 32,
                totalTokens: 152,
            },
        });
        session.recordToolExecution({
            id: 'tool_1',
            name: 'run_command',
            args: {
                command: 'pnpm test',
            },
            success: true,
            output: 'all green',
            metadata: {
                command: 'pnpm test',
                cwd: '/workspace/demo',
            },
        });
        session.recordToolExecution({
            id: 'tool_2',
            name: 'write_file',
            args: {
                path: 'README.md',
                content: '# Demo',
            },
            success: true,
            output: 'README updated',
            metadata: {
                path: '/workspace/demo/README.md',
                changeType: 'write',
                bytes: 6,
                existedBefore: true,
            },
        });

        const summary = store.saveSession({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        const loaded = store.getSession('session_demo');

        expect(summary).toMatchObject({
            id: 'session_demo',
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'Inspect demo project',
            messageCount: 4,
            usage: {
                promptTokens: 120,
                completionTokens: 32,
                totalTokens: 152,
            },
            commandCount: 1,
            fileChangeCount: 1,
            compactionCount: 0,
        });
        expect(loaded?.id).toBe('session_demo');
        expect(loaded?.getTitle()).toBe('Inspect demo project');
        expect(loaded?.getMessages()).toEqual(session.getMessages());
        expect(loaded?.getUsage()).toEqual(session.getUsage());
        expect(loaded?.getCommandHistory()).toEqual(session.getCommandHistory());
        expect(loaded?.getFileChanges()).toEqual(session.getFileChanges());
        expect(store.getSessionSummary('session_demo')).toMatchObject({
            id: 'session_demo',
            commandCount: 1,
            fileChangeCount: 1,
        });
    });

    it('updates a persisted session title without rewriting the full transcript', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_title_update',
            title: 'Initial title',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'Help me inspect the repo' },
            ],
        });

        store.saveSession({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });

        const updated = store.updateSessionTitle('session_title_update', 'Generated concise title');
        const reloaded = store.getSession('session_title_update');

        expect(updated.title).toBe('Generated concise title');
        expect(reloaded?.getTitle()).toBe('Generated concise title');
        expect(reloaded?.getMessages()).toHaveLength(2);
    });

    it('returns the latest session for a project when multiple snapshots exist', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);

        const first = new AgentSession({
            id: 'session_first',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [{ role: 'system', content: 'system prompt' }],
        });
        const second = new AgentSession({
            id: 'session_second',
            createdAt: new Date('2026-03-08T00:05:00.000Z'),
            messages: [{ role: 'system', content: 'system prompt' }],
        });

        store.saveSession({
            session: first,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        store.saveSession({
            session: second,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });

        expect(store.findLatestSession('/workspace/demo')?.id).toBe('session_second');
    });

    describe('Day 15: session sanitization and recovery', () => {
        it('redacts Bearer and token in persisted last_user_message and message content', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_sanitize',
                createdAt: new Date(),
                messages: [
                    { role: 'user', content: 'Use Bearer sk-abc123def456ghi789 and API_KEY=secret99' },
                    { role: 'assistant', content: 'Authorization: Bearer sk-xyz000' },
                ],
            });

            store.saveSession({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
            });

            const summary = store.getSessionSummary('session_sanitize');
            expect(summary?.lastUserMessage).toBeDefined();
            expect(summary!.lastUserMessage).not.toContain('sk-abc123def456ghi789');
            expect(summary!.lastUserMessage).not.toContain('secret99');
            expect(summary!.lastUserMessage).toContain('***');

            const loaded = store.getSession('session_sanitize');
            expect(loaded).not.toBeNull();
            const msgs = loaded!.getMessages();
            expect(msgs.some((m) => m.content?.includes('sk-abc123def456ghi789') || m.content?.includes('secret99'))).toBe(false);
            expect(msgs.some((m) => m.content?.includes('***'))).toBe(true);
        });

        it('normal recovery unaffected: message count and structure after save/load', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_recovery',
                createdAt: new Date(),
                messages: [
                    { role: 'system', content: 'You are a helper.' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there.' },
                ],
            });

            store.saveSession({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
            });

            const loaded = store.getSession('session_recovery');
            expect(loaded?.getMessages().length).toBe(3);
            expect(loaded?.getMessages().map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
            expect(loaded?.getMessages()[1]?.content).toBe('Hello');
            expect(loaded?.getMessages()[2]?.content).toBe('Hi there.');
        });

        it('when persistLastUserMessage is false, summary has no lastUserMessage', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_nolast',
                createdAt: new Date(),
                messages: [
                    { role: 'user', content: 'Secret user input' },
                ],
            });

            store.saveSession({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
                options: { persistLastUserMessage: false },
            });

            const summary = store.getSessionSummary('session_nolast');
            expect(summary?.lastUserMessage).toBeUndefined();
            const loaded = store.getSession('session_nolast');
            expect(loaded?.getMessages().length).toBe(1);
            expect(loaded?.getMessages()[0]?.content).toBe('Secret user input');
        });
    });
});
