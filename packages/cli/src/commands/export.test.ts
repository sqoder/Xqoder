import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { runExportCommand } from './export.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-export-'));
    tempDirs.push(dir);
    return dir;
}

describe('export command', () => {
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

    it('exports the latest session to a json file', async () => {
        const session = new AgentSession({
            id: 'session_demo',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
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
        });
        const outDir = createTempDir();
        const outFile = path.join(outDir, 'session.json');
        const listSessions = vi.fn().mockReturnValue([{
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
        }]);
        const getSessionSnapshot = vi.fn().mockReturnValue(session.toSnapshot());

        await runExportCommand(undefined, {
            dir: '/workspace/demo',
            format: 'json',
            out: outFile,
        }, {
            sessionStore: {
                listSessions,
                getSessionSnapshot,
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

        const exported = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as {
            schemaVersion: number;
            summary: {
                id: string;
                model: string;
            };
            snapshot: {
                id: string;
                messages: Array<{ role: string; content: string }>;
            };
        };

        expect(exported).toMatchObject({
            schemaVersion: 1,
            summary: {
                id: 'session_demo',
                model: 'claude-sonnet-4',
            },
            snapshot: {
                id: 'session_demo',
            },
        });
        expect(listSessions).toHaveBeenCalledWith('/workspace/demo', 1);
        expect(getSessionSnapshot).toHaveBeenCalledWith('session_demo');
        expect(exported.snapshot.messages).toHaveLength(3);
    });
});
