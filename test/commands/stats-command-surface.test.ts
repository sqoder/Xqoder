import { describe, expect, it } from 'bun:test';
import { runStatsCommand } from '../../src/commands/sessions/stats.js';

describe('stats command surface usage visibility', () => {
    it('shows rich usage in text output and aggregates cost in top rows', () => {
        const output: string[] = [];

        const report = runStatsCommand({
            dir: '/workspace/demo',
        }, {
            writeOutput: (value) => output.push(value),
            sessionStore: {
                listSessions: () => [
                    createSessionSummary({
                        id: 'demo-1',
                        projectRoot: '/workspace/demo',
                        model: 'openai/gpt-4.1',
                        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
                        usage: {
                            promptTokens: 21,
                            completionTokens: 5,
                            totalTokens: 26,
                            cacheReadTokens: 8,
                            cacheCreationTokens: 3,
                            cost: 0.45,
                        },
                    }),
                    createSessionSummary({
                        id: 'demo-2',
                        projectRoot: '/workspace/demo',
                        model: 'openai/gpt-4.1-mini',
                        updatedAt: new Date('2026-04-21T08:05:00.000Z'),
                        usage: {
                            promptTokens: 10,
                            completionTokens: 2,
                            totalTokens: 12,
                            cacheReadTokens: 4,
                            cacheCreationTokens: 1,
                            cost: 0.05,
                        },
                    }),
                ],
            },
        });

        expect(report.usage).toMatchObject({
            promptTokens: 31,
            completionTokens: 7,
            totalTokens: 38,
            cacheReadTokens: 12,
            cacheCreationTokens: 4,
            cost: 0.5,
        });
        expect(report.topModels.find((entry) => entry.model === 'openai/gpt-4.1')).toMatchObject({
            model: 'openai/gpt-4.1',
            count: 1,
            totalTokens: 26,
            cost: 0.45,
        });
        expect(output.join('\n')).toContain(
            'Usage: prompt=31, completion=7, total=38, cacheRead=12, cacheCreate=4, cost=$0.50',
        );
        expect(output.join('\n')).toContain('- openai/gpt-4.1  sessions=1  tokens=26  cost=$0.45');
        expect(output.join('\n')).toContain('- /workspace/demo  sessions=2  tokens=38  cost=$0.50');
    });

    it('emits extended usage fields in json output', () => {
        const output: string[] = [];

        runStatsCommand({
            dir: '/workspace/demo',
            json: true,
        }, {
            writeOutput: (value) => output.push(value),
            sessionStore: {
                listSessions: () => [
                    createSessionSummary({
                        id: 'demo-json',
                        projectRoot: '/workspace/demo',
                        model: 'openai/gpt-4.1',
                        updatedAt: new Date('2026-04-20T08:05:00.000Z'),
                        usage: {
                            promptTokens: 21,
                            completionTokens: 5,
                            totalTokens: 26,
                            cacheReadTokens: 8,
                            cacheCreationTokens: 3,
                            cost: 0.45,
                        },
                    }),
                ],
            },
        });

        expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
            usage: {
                promptTokens: 21,
                completionTokens: 5,
                totalTokens: 26,
                cacheReadTokens: 8,
                cacheCreationTokens: 3,
                cost: 0.45,
            },
            topModels: [{
                model: 'openai/gpt-4.1',
                count: 1,
                totalTokens: 26,
                cost: 0.45,
            }],
            topProjects: [{
                projectRoot: '/workspace/demo',
                count: 1,
                totalTokens: 26,
                cost: 0.45,
            }],
        });
    });
});

function createSessionSummary(input: {
    id: string;
    projectRoot: string;
    model: string;
    updatedAt: Date;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        cost?: number;
    };
}) {
    return {
        id: input.id,
        projectRoot: input.projectRoot,
        cwd: input.projectRoot,
        model: input.model,
        title: input.id,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
        maxMessages: 64,
        messageCount: 3,
        usage: input.usage,
        compactionCount: 0,
        commandCount: 1,
        fileChangeCount: 0,
    };
}
