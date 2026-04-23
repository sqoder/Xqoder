import { describe, expect, it } from 'bun:test';
import {
    buildSessionStatsReport,
    formatSessionStatsReport,
} from '../../../src/features/sessions/assets.js';

describe('session stats helper usage aggregation', () => {
    it('aggregates optional usage fields and renders them in the formatted report', () => {
        const report = buildSessionStatsReport([
            createSessionSummary({
                id: 'stats-1',
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
                id: 'stats-2',
                projectRoot: '/workspace/demo',
                model: 'openai/gpt-4.1',
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
        ], {
            allProjects: false,
            projectRoot: '/workspace/demo',
        });

        expect(report.usage).toMatchObject({
            promptTokens: 31,
            completionTokens: 7,
            totalTokens: 38,
            cacheReadTokens: 12,
            cacheCreationTokens: 4,
            cost: 0.5,
        });
        expect(report.topModels).toEqual([{
            model: 'openai/gpt-4.1',
            count: 2,
            totalTokens: 38,
            cost: 0.5,
        }]);
        expect(report.topProjects).toEqual([{
            projectRoot: '/workspace/demo',
            count: 2,
            totalTokens: 38,
            cost: 0.5,
        }]);

        const formatted = formatSessionStatsReport(report);
        expect(formatted).toContain(
            'Usage: prompt=31, completion=7, total=38, cacheRead=12, cacheCreate=4, cost=$0.50',
        );
        expect(formatted).toContain('- openai/gpt-4.1  sessions=2  tokens=38  cost=$0.50');
        expect(formatted).toContain('- /workspace/demo  sessions=2  tokens=38  cost=$0.50');
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
