import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runImportCommand } from './import.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-import-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('import command', () => {
    it('imports an exported session document into the local store', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: '帮我看下这个仓库',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
                lastUserMessage: '帮我看下这个仓库',
            },
            snapshot: {
                id: 'session_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: '帮我看下这个仓库' },
                    { role: 'assistant', content: '先从目录结构开始。' },
                ],
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const saveSession = vi.fn().mockReturnValue({
            id: 'session_demo',
            projectRoot: '/workspace/imported',
            cwd: '/workspace/imported',
            model: 'claude-sonnet-4',
            title: '帮我看下这个仓库',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:10:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: {
                promptTokens: 100,
                completionTokens: 20,
                totalTokens: 120,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported',
        }, {
            sessionStore: {
                getSession: vi.fn().mockReturnValue(null),
                saveSession,
            },
        });

        expect(saveSession).toHaveBeenCalledTimes(1);
        expect(saveSession.mock.calls[0]?.[0]).toMatchObject({
            projectRoot: '/workspace/imported',
            cwd: '/workspace/imported',
            model: 'claude-sonnet-4',
        });
        expect(saveSession.mock.calls[0]?.[0].session.id).toBe('session_demo');
    });

    it('imports a compatible export payload without schemaVersion and missing metadata arrays', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'compatible-session.json');
        fs.writeFileSync(filePath, JSON.stringify({
            sessionId: 'opencode_session_demo',
            projectRoot: '/workspace/opencode-demo',
            cwd: '/workspace/opencode-demo',
            model: 'gpt-5',
            title: 'compatible session import',
            createdAt: '2026-03-08T01:00:00.000Z',
            updatedAt: '2026-03-08T01:05:00.000Z',
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'hello from compatible export' },
                { role: 'assistant', content: 'compatible reply' },
            ],
            usage: {
                promptTokens: 12,
                completionTokens: 8,
                totalTokens: 20,
            },
            metadata: {
                compactSummary: 'short summary',
            },
        }, null, 2), 'utf-8');

        const saveSession = vi.fn().mockReturnValue({
            id: 'opencode_session_demo',
            projectRoot: '/workspace/imported-compatible',
            cwd: '/workspace/imported-compatible',
            model: 'gpt-5',
            title: 'compatible session import',
            createdAt: new Date('2026-03-08T01:00:00.000Z'),
            updatedAt: new Date('2026-03-08T01:05:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: {
                promptTokens: 12,
                completionTokens: 8,
                totalTokens: 20,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported-compatible',
        }, {
            sessionStore: {
                getSession: vi.fn().mockReturnValue(null),
                saveSession,
            },
        });

        expect(saveSession).toHaveBeenCalledTimes(1);
        expect(saveSession.mock.calls[0]?.[0]).toMatchObject({
            projectRoot: '/workspace/imported-compatible',
            cwd: '/workspace/imported-compatible',
            model: 'gpt-5',
        });
        expect(saveSession.mock.calls[0]?.[0].session.id).toBe('opencode_session_demo');

        const snapshot = saveSession.mock.calls[0]?.[0].session.toSnapshot();
        expect(snapshot.metadata.compactSummary).toBe('short summary');
        expect(snapshot.metadata.compactions).toEqual([]);
        expect(snapshot.metadata.commandHistory).toEqual([]);
        expect(snapshot.metadata.toolHistory).toEqual([]);
        expect(snapshot.metadata.fileChanges).toEqual([]);
    });
});
