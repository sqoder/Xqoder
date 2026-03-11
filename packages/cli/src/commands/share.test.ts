import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import {
    FileSessionShareStore,
    runCreateShareCommand,
    runListSharesCommand,
    runRemoveShareCommand,
    runShowShareCommand,
} from './share.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-share-'));
    tempDirs.push(dir);
    return dir;
}

describe('share command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('creates, lists, shows, and removes a local share asset', async () => {
        const shareDir = createTempDir();
        const shareStore = new FileSessionShareStore(shareDir);
        const session = new AgentSession({
            id: 'session_demo',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '帮我看下这个仓库' },
                { role: 'assistant', content: '先从目录结构开始。' },
            ],
        });

        const share = runCreateShareCommand(undefined, {
            dir: '/workspace/demo',
            format: 'markdown',
        }, {
            shareStore,
            sessionStore: {
                findLatestSession: vi.fn().mockReturnValue(session),
                getSession: vi.fn(),
                getSessionSummary: vi.fn().mockReturnValue({
                    id: 'session_demo',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'claude-sonnet-4',
                    title: '帮我看下这个仓库',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:05:00.000Z'),
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
                }),
            },
        });

        expect(share.id).toMatch(/^share_/);
        expect(fs.existsSync(share.artifactPath)).toBe(true);

        runListSharesCommand({
            dir: '/workspace/demo',
        }, {
            shareStore,
        });
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(share.id));

        const detail = runShowShareCommand(share.id, {
            shareStore,
        });
        expect(detail.artifactPath).toBe(share.artifactPath);
        expect(detail.content).toContain('# 帮我看下这个仓库');

        const removed = await runRemoveShareCommand(share.id, {
            yes: true,
        }, {
            shareStore,
        });
        expect(removed.id).toBe(share.id);
        expect(fs.existsSync(share.artifactPath)).toBe(false);
    });
});
