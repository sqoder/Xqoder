import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '@xqoder/runtime';
import type { WorkflowRunRecord } from '../services/workflow-history.js';
import { runStatsCommand } from './stats.js';

describe('stats command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('prints aggregate session stats for the current project', async () => {
        await runStatsCommand({
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
                            cost: 0.05,
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
                            cost: 0.03,
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
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Cost: $0.080'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Top Models:'));
    });

    it('returns json stats with limited model breakdown when --json is enabled', async () => {
        await runStatsCommand({
            dir: '/workspace/demo',
            json: true,
            models: '1',
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
                            cost: 0.05,
                        },
                        compactionCount: 1,
                        commandCount: 2,
                        fileChangeCount: 1,
                    },
                    {
                        id: 'session_2',
                        projectRoot: '/workspace/demo',
                        cwd: '/workspace/demo',
                        model: 'gpt-5',
                        title: '补 benchmark',
                        createdAt: new Date('2026-03-08T01:00:00.000Z'),
                        updatedAt: new Date('2026-03-08T01:05:00.000Z'),
                        maxMessages: 100,
                        messageCount: 5,
                        usage: {
                            promptTokens: 60,
                            completionTokens: 40,
                            totalTokens: 100,
                            cost: 0.12,
                        },
                        compactionCount: 0,
                        commandCount: 1,
                        fileChangeCount: 2,
                    },
                ]),
            },
        });

        const output = consoleLog.mock.calls.at(-1)?.[0];
        expect(() => JSON.parse(output as string)).not.toThrow();
        expect(JSON.parse(output as string)).toMatchObject({
            sessionCount: 2,
            usage: {
                totalTokens: 250,
                costUsd: 0.17,
            },
            topModels: [{
                model: 'claude-sonnet-4',
                totalTokens: 150,
                costUsd: 0.05,
            }],
        });
    });

    it('loads top tools from detailed session history when --tools is requested', async () => {
        const records: SessionRecord[] = [
            {
                id: 'session_1',
                cwd: '/workspace/demo',
                title: '修复 build',
                createdAt: Date.parse('2026-03-08T00:00:00.000Z'),
                updatedAt: Date.parse('2026-03-08T00:05:00.000Z'),
                messages: [],
                metadata: {
                    projectRoot: '/workspace/demo',
                    model: 'claude-sonnet-4',
                    maxMessages: 100,
                    messageCount: 3,
                    promptTokens: 120,
                    completionTokens: 30,
                    totalTokens: 150,
                    toolHistory: [
                        { name: 'run_command', success: true },
                        { name: 'run_command', success: false },
                        { name: 'read_file', success: true },
                        { name: 'read_file', success: true },
                    ],
                },
            },
            {
                id: 'session_2',
                cwd: '/workspace/demo',
                title: '补测试',
                createdAt: Date.parse('2026-03-08T01:00:00.000Z'),
                updatedAt: Date.parse('2026-03-08T01:10:00.000Z'),
                messages: [],
                metadata: {
                    projectRoot: '/workspace/demo',
                    model: 'gpt-5',
                    maxMessages: 100,
                    messageCount: 2,
                    promptTokens: 80,
                    completionTokens: 20,
                    totalTokens: 100,
                    toolHistory: [
                        { name: 'run_command', success: true },
                        { name: 'edit_file', success: true },
                    ],
                },
            },
        ];

        await runStatsCommand({
            dir: '/workspace/demo',
            json: true,
            tools: '2',
        }, {
            sessionStore: {
                listSessions: vi.fn().mockResolvedValue(records),
                loadSessionSnapshot: vi.fn(async (sessionId: string) => records.find((record) => record.id === sessionId)),
            },
        });

        const output = consoleLog.mock.calls.at(-1)?.[0];
        expect(() => JSON.parse(output as string)).not.toThrow();
        expect(JSON.parse(output as string)).toMatchObject({
            topTools: [
                {
                    name: 'run_command',
                    count: 3,
                    successCount: 2,
                    failureCount: 1,
                },
                {
                    name: 'read_file',
                    count: 2,
                    successCount: 2,
                    failureCount: 0,
                },
            ],
        });
    });

    it('filters and returns matching sessions when --search is used', async () => {
        const records: SessionRecord[] = [
            {
                id: 'session_match',
                cwd: '/workspace/demo',
                title: '修复 ESLint 配置',
                createdAt: Date.parse('2026-03-08T00:00:00.000Z'),
                updatedAt: Date.parse('2026-03-08T00:05:00.000Z'),
                messages: [],
                metadata: {
                    projectRoot: '/workspace/demo',
                    model: 'gpt-5',
                    maxMessages: 100,
                    messageCount: 4,
                    promptTokens: 90,
                    completionTokens: 30,
                    totalTokens: 120,
                    lastUserMessage: '修复 eslint 相关错误',
                },
            },
            {
                id: 'session_other',
                cwd: '/workspace/demo',
                title: '补 benchmark',
                createdAt: Date.parse('2026-03-08T01:00:00.000Z'),
                updatedAt: Date.parse('2026-03-08T01:05:00.000Z'),
                messages: [],
                metadata: {
                    projectRoot: '/workspace/demo',
                    model: 'claude-sonnet-4',
                    maxMessages: 100,
                    messageCount: 2,
                    promptTokens: 20,
                    completionTokens: 10,
                    totalTokens: 30,
                },
            },
        ];

        await runStatsCommand({
            dir: '/workspace/demo',
            json: true,
            search: 'eslint',
        }, {
            sessionStore: {
                listSessions: vi.fn().mockResolvedValue(records),
                loadSessionSnapshot: vi.fn(async (sessionId: string) => records.find((record) => record.id === sessionId)),
            },
        });

        const output = consoleLog.mock.calls.at(-1)?.[0];
        expect(JSON.parse(output as string)).toMatchObject({
            sessionCount: 1,
            matchingSessions: [{
                id: 'session_match',
                title: '修复 ESLint 配置',
            }],
        });
    });

    it('includes workflow history and recent fixes when requested', async () => {
        await runStatsCommand({
            dir: '/workspace/demo',
            json: true,
            workflows: '2',
            fixes: '1',
        }, {
            sessionStore: {
                listSessions: vi.fn().mockResolvedValue([]),
                loadSessionSnapshot: vi.fn(),
            },
            now: new Date('2026-03-22T12:00:00.000Z'),
            workflowHistoryStore: {
                append: vi.fn(),
                list: vi.fn((options?: { flow?: string; limit?: number }) => {
                    if (options?.flow === 'fix') {
                        const fixRuns: WorkflowRunRecord[] = [{
                            id: 'fix_1',
                            flow: 'fix',
                            projectRoot: '/workspace/demo',
                            projectName: 'demo',
                            userRequest: '修复编译错误',
                            status: 'completed',
                            success: true,
                            startedAt: '2026-03-22T01:00:00.000Z',
                            completedAt: '2026-03-22T01:02:00.000Z',
                            totalDurationMs: 120000,
                            attemptCount: 2,
                            repaired: true,
                            resultLabel: 'http://localhost:3000',
                            remediationPolicyIds: ['compile-error-v1'],
                            suspectedFailureBuckets: ['runtime_compile_error'],
                            automaticActionIds: ['auto-install-dependency-v1'],
                        }];
                        return fixRuns;
                    }
                    const workflowRuns: WorkflowRunRecord[] = [
                        {
                            id: 'workflow_2',
                            flow: 'fix',
                            projectRoot: '/workspace/demo',
                            projectName: 'demo',
                            userRequest: '修复编译错误',
                            status: 'completed',
                            success: true,
                            startedAt: '2026-03-22T01:00:00.000Z',
                            completedAt: '2026-03-22T01:02:00.000Z',
                            totalDurationMs: 120000,
                            attemptCount: 2,
                            repaired: true,
                            resultLabel: 'http://localhost:3000',
                            remediationPolicyIds: ['compile-error-v1'],
                            suspectedFailureBuckets: ['runtime_compile_error'],
                            automaticActionIds: ['auto-install-dependency-v1'],
                        },
                        {
                            id: 'workflow_1',
                            flow: 'build',
                            projectRoot: '/workspace/demo',
                            projectName: 'demo',
                            userRequest: '生成 dashboard',
                            status: 'failed',
                            success: false,
                            startedAt: '2026-03-22T00:00:00.000Z',
                            completedAt: '2026-03-22T00:01:00.000Z',
                            totalDurationMs: 60000,
                            failureBucket: 'test_failed',
                            error: 'tests failed',
                        },
                    ];
                    return workflowRuns;
                }),
            },
        });

        const output = consoleLog.mock.calls.at(-1)?.[0];
        expect(JSON.parse(output as string)).toMatchObject({
            workflowHistory: {
                totalRuns: 2,
                successfulRuns: 1,
                failedRuns: 1,
                successRate: 0.5,
                failureBuckets: [{
                    bucket: 'test_failed',
                    count: 1,
                }],
                policyPerformance: [{
                    policyId: 'compile-error-v1',
                    count: 1,
                    successfulRuns: 1,
                    failedRuns: 0,
                    successRate: 1,
                }],
                policyBucketPerformance: [{
                    policyId: 'compile-error-v1',
                    bucket: 'runtime_compile_error',
                    count: 1,
                    successfulRuns: 1,
                    failedRuns: 0,
                    successRate: 1,
                }],
                automaticActionPerformance: [{
                    actionId: 'auto-install-dependency-v1',
                    count: 1,
                    successfulRuns: 1,
                    failedRuns: 0,
                    successRate: 1,
                }],
                automaticActionBucketPerformance: [{
                    actionId: 'auto-install-dependency-v1',
                    bucket: 'runtime_compile_error',
                    count: 1,
                    successfulRuns: 1,
                    failedRuns: 0,
                    successRate: 1,
                }],
                automaticActionPromotionCandidates: [],
            },
            recentFixes: [{
                id: 'fix_1',
                attemptCount: 2,
                repaired: true,
            }],
        });
    });
});
