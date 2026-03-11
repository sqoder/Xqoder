import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runStatsCommand } from './stats.js';

describe('stats command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('prints aggregate session stats for the current project', () => {
        runStatsCommand({
            dir: '/workspace/demo',
        }, {
            sessionStore: {
                listSessions: vi.fn().mockReturnValue([
                    {
                        id: 'session_1',
                        projectRoot: '/workspace/demo',
                        cwd: '/workspace/demo',
                        model: 'claude-sonnet-4',
                        title: '分析仓库结构',
                        createdAt: new Date('2026-03-08T00:00:00.000Z'),
                        updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                        maxMessages: 100,
                        messageCount: 8,
                        usage: {
                            promptTokens: 120,
                            completionTokens: 30,
                            totalTokens: 150,
                        },
                        compactionCount: 1,
                        commandCount: 2,
                        fileChangeCount: 1,
                    },
                    {
                        id: 'session_2',
                        projectRoot: '/workspace/demo',
                        cwd: '/workspace/demo',
                        model: 'gpt-4.1',
                        title: '补测试',
                        createdAt: new Date('2026-03-08T01:00:00.000Z'),
                        updatedAt: new Date('2026-03-08T01:10:00.000Z'),
                        maxMessages: 100,
                        messageCount: 5,
                        usage: {
                            promptTokens: 80,
                            completionTokens: 20,
                            totalTokens: 100,
                        },
                        compactionCount: 0,
                        commandCount: 1,
                        fileChangeCount: 3,
                    },
                ]),
            },
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Sessions: 2'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Messages: 13'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Tokens: prompt=200, completion=50, total=250'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Top Models:'));
    });

    it('returns json stats when --json is enabled', () => {
        runStatsCommand({
            dir: '/workspace/demo',
            json: true,
        }, {
            sessionStore: {
                listSessions: vi.fn().mockReturnValue([
                    {
                        id: 'session_1',
                        projectRoot: '/workspace/demo',
                        cwd: '/workspace/demo',
                        model: 'claude-sonnet-4',
                        title: '分析仓库结构',
                        createdAt: new Date('2026-03-08T00:00:00.000Z'),
                        updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                        maxMessages: 100,
                        messageCount: 8,
                        usage: {
                            promptTokens: 120,
                            completionTokens: 30,
                            totalTokens: 150,
                        },
                        compactionCount: 1,
                        commandCount: 2,
                        fileChangeCount: 1,
                    },
                ]),
            },
        });

        const output = consoleLog.mock.calls.at(-1)?.[0];
        expect(() => JSON.parse(output as string)).not.toThrow();
        expect(JSON.parse(output as string)).toMatchObject({
            sessionCount: 1,
            usage: {
                totalTokens: 150,
            },
        });
    });
});
