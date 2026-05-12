import { describe, expect, it } from 'bun:test';
import { BUILT_IN_AGENTS } from '../../../../src/core/agent/subagents/built-in.js';
import {
    DEFAULT_FORK_CONCURRENCY,
    areAllConcurrencySafe,
    forkSubagentsBatch,
} from '../../../../src/core/agent/subagents/batch.js';
import type {
    ForkSpec,
    ForkSubagentDependencies,
    ForkableChildSession,
} from '../../../../src/core/agent/subagents/fork.js';

function makeSpec(task: string, agentName: keyof typeof BUILT_IN_AGENTS = 'explore'): ForkSpec {
    return {
        agent: BUILT_IN_AGENTS[agentName]!,
        task,
        toolNames: ['read_file'],
    };
}

function makeChild(): ForkableChildSession & {
    messages: Array<{ role: string; content: string }>;
} {
    const child = {
        messages: [] as Array<{ role: string; content: string }>,
        getMessages() { return this.messages as unknown as ReturnType<ForkableChildSession['getMessages']>; },
        getUsage() { return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }; },
        getReadFiles() { return [] as string[]; },
        setSystemPrompt(_s: string) { /* noop */ },
        addUserMessage(c: string) { this.messages.push({ role: 'user', content: c }); },
    };
    return child as unknown as ForkableChildSession & { messages: Array<{ role: string; content: string }> };
}

describe('forkSubagentsBatch (P16c)', () => {
    it('preserves input order in outcomes', async () => {
        const specs = [makeSpec('a'), makeSpec('b'), makeSpec('c')];
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async (child, spec) => {
                const messages = (child as unknown as { messages: Array<{ role: string; content: string }> }).messages;
                messages.push({ role: 'assistant', content: 'reply:' + spec.task });
            },
        };
        const outcomes = await forkSubagentsBatch({ readFiles: [] }, specs, deps);
        expect(outcomes.length).toBe(3);
        expect(outcomes[0]?.status).toBe('ok');
        if (outcomes[0]?.status === 'ok') expect(outcomes[0].result.snapshot.finalResponse).toBe('reply:a');
        if (outcomes[1]?.status === 'ok') expect(outcomes[1].result.snapshot.finalResponse).toBe('reply:b');
        if (outcomes[2]?.status === 'ok') expect(outcomes[2].result.snapshot.finalResponse).toBe('reply:c');
    });

    it('caps concurrency: never more than maxConcurrency in flight at once', async () => {
        let inFlight = 0;
        let peak = 0;
        const specs = Array.from({ length: 10 }, (_, i) => makeSpec('t' + i));
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async (child) => {
                inFlight += 1;
                if (inFlight > peak) peak = inFlight;
                await new Promise((resolve) => setTimeout(resolve, 5));
                const messages = (child as unknown as { messages: Array<{ role: string; content: string }> }).messages;
                messages.push({ role: 'assistant', content: 'ok' });
                inFlight -= 1;
            },
        };
        await forkSubagentsBatch({ readFiles: [] }, specs, deps, { maxConcurrency: 3 });
        expect(peak).toBeLessThanOrEqual(3);
        expect(peak).toBeGreaterThan(0);
    });

    it('returns error outcome when a single fork throws, does not poison the batch', async () => {
        const specs = [makeSpec('ok1'), makeSpec('boom'), makeSpec('ok2')];
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async (child, spec) => {
                if (spec.task === 'boom') throw new Error('child exploded');
                const messages = (child as unknown as { messages: Array<{ role: string; content: string }> }).messages;
                messages.push({ role: 'assistant', content: 'done' });
            },
        };
        const outcomes = await forkSubagentsBatch({ readFiles: [] }, specs, deps);
        expect(outcomes[0]?.status).toBe('ok');
        expect(outcomes[1]?.status).toBe('error');
        expect(outcomes[2]?.status).toBe('ok');
        if (outcomes[1]?.status === 'error') {
            expect(outcomes[1].error.message).toBe('child exploded');
        }
    });

    it('respects cap=1 (serial execution)', async () => {
        let inFlight = 0;
        let peak = 0;
        const specs = [makeSpec('a'), makeSpec('b'), makeSpec('c')];
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async (child) => {
                inFlight += 1;
                if (inFlight > peak) peak = inFlight;
                await new Promise((resolve) => setTimeout(resolve, 5));
                const messages = (child as unknown as { messages: Array<{ role: string; content: string }> }).messages;
                messages.push({ role: 'assistant', content: 'ok' });
                inFlight -= 1;
            },
        };
        await forkSubagentsBatch({ readFiles: [] }, specs, deps, { maxConcurrency: 1 });
        expect(peak).toBe(1);
    });

    it('handles an empty input list without hanging', async () => {
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async () => { /* noop */ },
        };
        const outcomes = await forkSubagentsBatch({ readFiles: [] }, [], deps);
        expect(outcomes).toEqual([]);
    });

    it('defaults to concurrency 4 when maxConcurrency not supplied', () => {
        expect(DEFAULT_FORK_CONCURRENCY).toBe(4);
    });

    it('stops scheduling new forks once signal aborts (already-in-flight still complete)', async () => {
        const specs = Array.from({ length: 8 }, (_, i) => makeSpec('t' + i));
        let started = 0;
        const controller = new AbortController();
        const deps: ForkSubagentDependencies = {
            createChildSession: () => makeChild(),
            runChild: async (child) => {
                started += 1;
                if (started === 1) controller.abort();
                await new Promise((resolve) => setTimeout(resolve, 1));
                const messages = (child as unknown as { messages: Array<{ role: string; content: string }> }).messages;
                messages.push({ role: 'assistant', content: 'ok' });
            },
        };
        await forkSubagentsBatch({ readFiles: [] }, specs, deps, {
            maxConcurrency: 2,
            signal: controller.signal,
        });
        expect(started).toBeLessThan(specs.length);
    });
});

describe('areAllConcurrencySafe (P16c)', () => {
    it('returns true when every agent is concurrencySafe', () => {
        expect(areAllConcurrencySafe([makeSpec('a', 'explore'), makeSpec('b', 'plan')])).toBe(true);
    });
    it('returns false when any agent is not concurrencySafe', () => {
        expect(areAllConcurrencySafe([
            makeSpec('a', 'explore'),
            makeSpec('b', 'general-purpose'),
        ])).toBe(false);
    });
    it('returns true for an empty list', () => {
        expect(areAllConcurrencySafe([])).toBe(true);
    });
});
