import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { runListSessionsCommand, runShowSessionCommand } from './sessions.js';

describe('sessions command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('lists persisted sessions for the current project', () => {
        runListSessionsCommand({
            dir: '/workspace/demo',
            limit: '5',
        }, {
            sessionStore: {
                listSessions: vi.fn().mockReturnValue([
                    {
                        id: 'session_1',
                        projectRoot: '/workspace/demo',
                        cwd: '/workspace/demo',
                        model: 'gpt-4o',
                        title: '分析目录结构',
                        createdAt: new Date('2026-03-08T00:00:00.000Z'),
                        updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                        maxMessages: 100,
                        messageCount: 8,
                        usage: {
                            promptTokens: 100,
                            completionTokens: 30,
                            totalTokens: 130,
                        },
                        compactionCount: 1,
                        commandCount: 2,
                        fileChangeCount: 1,
                    },
                ]),
                findLatestSession: vi.fn(),
                getSession: vi.fn(),
                getSessionSummary: vi.fn(),
            },
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('session_1'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('commands=2'));
    });

    it('shows transcript and histories for a selected session', () => {
        const session = new AgentSession({
            id: 'session_2',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '先运行测试' },
                { role: 'assistant', content: '我去跑一下。' },
            ],
        });
        session.recordToolExecution({
            id: 'tool_cmd',
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
            id: 'tool_write',
            name: 'write_file',
            args: {
                path: 'src/index.ts',
                content: 'console.log("demo")',
            },
            success: true,
            output: 'file written',
            metadata: {
                path: '/workspace/demo/src/index.ts',
                changeType: 'write',
                bytes: 19,
                existedBefore: true,
            },
        });

        runShowSessionCommand('session_2', {
            dir: '/workspace/demo',
            transcriptLimit: '10',
            historyLimit: '10',
        }, {
            sessionStore: {
                getSession: vi.fn().mockReturnValue(session),
                getSessionSummary: vi.fn().mockReturnValue({
                    id: 'session_2',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'gpt-4o',
                    title: '先运行测试',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                    maxMessages: 100,
                    messageCount: 3,
                    usage: {
                        promptTokens: 50,
                        completionTokens: 20,
                        totalTokens: 70,
                    },
                    compactionCount: 0,
                    commandCount: 1,
                    fileChangeCount: 1,
                    lastUserMessage: '先运行测试',
                }),
                listSessions: vi.fn(),
                findLatestSession: vi.fn(),
            },
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Command History:'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('pnpm test'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('src/index.ts'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Recent Transcript:'));
    });
});
