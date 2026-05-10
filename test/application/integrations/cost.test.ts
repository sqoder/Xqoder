import { describe, expect, it } from 'bun:test';
import type { AgentSessionStore, PersistedSessionSummary } from '@xqoder/storage-sqlite';
import {
    runCostCommand,
    type CostReport,
} from '../../../src/application/integrations/cost.js';

function makeSummary(overrides: Partial<PersistedSessionSummary> = {}): PersistedSessionSummary {
    const base: PersistedSessionSummary = {
        id: overrides.id ?? 'sess-1',
        projectRoot: overrides.projectRoot ?? '/projects/demo',
        cwd: overrides.cwd ?? '/projects/demo',
        model: overrides.model ?? 'gpt-4o',
        title: overrides.title ?? 'Test session',
        createdAt: overrides.createdAt ?? new Date('2025-05-01T10:00:00Z'),
        updatedAt: overrides.updatedAt ?? new Date('2025-05-01T10:05:00Z'),
        maxMessages: overrides.maxMessages ?? 200,
        messageCount: overrides.messageCount ?? 10,
        usage: overrides.usage ?? {
            promptTokens: 1_000_000,
            completionTokens: 100_000,
            totalTokens: 1_100_000,
            cacheReadTokens: 500_000,
            cacheCreationTokens: 0,
        },
        compactionCount: overrides.compactionCount ?? 0,
        commandCount: overrides.commandCount ?? 0,
        fileChangeCount: overrides.fileChangeCount ?? 0,
    };
    return overrides.lastUserMessage !== undefined
        ? { ...base, lastUserMessage: overrides.lastUserMessage }
        : base;
}

function makeStore(summaries: readonly PersistedSessionSummary[]): Pick<AgentSessionStore, 'listSessions' | 'getSessionSummary'> {
    return {
        listSessions: (projectRoot?: string) => {
            if (!projectRoot) return [...summaries];
            return summaries.filter((summary) => summary.projectRoot === projectRoot);
        },
        getSessionSummary: (sessionId: string) => summaries.find((summary) => summary.id === sessionId) ?? null,
    };
}

describe('runCostCommand (P15b)', () => {
    it('reports a single explicit session via --session', () => {
        const store = makeStore([
            makeSummary({ id: 'alpha', projectRoot: '/projects/alpha' }),
            makeSummary({ id: 'beta', projectRoot: '/projects/beta' }),
        ]);
        const lines: string[] = [];
        const report = runCostCommand(
            { session: 'alpha' },
            { sessionStore: store, writeOutput: (line) => lines.push(line) },
        );
        expect(report.scope).toBe('session');
        expect(report.sessions).toHaveLength(1);
        expect(report.sessions[0]!.sessionId).toBe('alpha');
        expect(report.aggregate.sessions).toBe(1);
        expect(report.aggregate.costUsd).toBeGreaterThan(0);
        expect(lines[0]).toContain('cost (session)');
    });

    it('aggregates sessions filtered by project dir by default', () => {
        const store = makeStore([
            makeSummary({ id: 'a', projectRoot: '/projects/alpha' }),
            makeSummary({ id: 'b', projectRoot: '/projects/alpha' }),
            makeSummary({ id: 'c', projectRoot: '/projects/beta' }),
        ]);
        const report = runCostCommand(
            { dir: '/projects/alpha' },
            { sessionStore: store, writeOutput: () => { /* noop */ } },
        );
        expect(report.scope).toBe('project');
        expect(report.sessions).toHaveLength(2);
        expect(report.aggregate.sessions).toBe(2);
    });

    it('--total returns every session across all projects', () => {
        const store = makeStore([
            makeSummary({ id: 'a', projectRoot: '/projects/alpha' }),
            makeSummary({ id: 'b', projectRoot: '/projects/beta' }),
        ]);
        const report = runCostCommand(
            { total: true },
            { sessionStore: store, writeOutput: () => { /* noop */ } },
        );
        expect(report.scope).toBe('total');
        expect(report.sessions).toHaveLength(2);
    });

    it('computes cache hit rate across sessions', () => {
        const store = makeStore([
            makeSummary({
                id: 'a',
                usage: {
                    promptTokens: 1000,
                    completionTokens: 50,
                    totalTokens: 1050,
                    cacheReadTokens: 700,
                    cacheCreationTokens: 100,
                },
            }),
            makeSummary({
                id: 'b',
                usage: {
                    promptTokens: 200,
                    completionTokens: 20,
                    totalTokens: 220,
                },
            }),
        ]);
        const report = runCostCommand(
            { total: true },
            { sessionStore: store, writeOutput: () => { /* noop */ } },
        );
        expect(report.cacheStats.hit).toBe(700);
        // miss = regularInput sum = (1000 - 700) + 200 = 500
        expect(report.cacheStats.miss).toBe(500);
        expect(report.cacheStats.hitRate).toBeCloseTo(700 / 1200, 5);
    });

    it('throws when --session id is not found', () => {
        const store = makeStore([makeSummary({ id: 'known' })]);
        expect(() => runCostCommand(
            { session: 'missing' },
            { sessionStore: store, writeOutput: () => { /* noop */ } },
        )).toThrow(/session not found: missing/);
    });

    it('falls back to calculated cost when summary.usage.cost is missing', () => {
        const store = makeStore([
            makeSummary({
                id: 'no-cost',
                usage: {
                    promptTokens: 1_000_000,
                    completionTokens: 0,
                    totalTokens: 1_000_000,
                },
            }),
        ]);
        const report = runCostCommand(
            { session: 'no-cost' },
            { sessionStore: store, writeOutput: () => { /* noop */ } },
        );
        expect(report.sessions[0]!.costUsd).toBeGreaterThan(0);
    });

    it('--json emits the full report as JSON', () => {
        const store = makeStore([makeSummary({ id: 'j' })]);
        const lines: string[] = [];
        runCostCommand(
            { session: 'j', json: true },
            { sessionStore: store, writeOutput: (line) => lines.push(line) },
        );
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]!) as CostReport;
        expect(parsed.scope).toBe('session');
        expect(parsed.sessions).toHaveLength(1);
    });

    it('prints "no sessions in scope" when the store is empty', () => {
        const lines: string[] = [];
        runCostCommand(
            { dir: '/empty' },
            { sessionStore: makeStore([]), writeOutput: (line) => lines.push(line) },
        );
        expect(lines).toContain('no sessions in scope');
    });
});
