import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { HooksSettings } from '@xqoder/shared';
import { XQoderAgent } from '../../../src/core/agent/agent.js';
import {
    __resetTelemetrySinkForTests,
    createInMemorySink,
    setTelemetrySink,
    type TelemetryEvent,
} from '../../../src/shared/telemetry/index.js';

const tempDirs: string[] = [];
let memorySink: ReturnType<typeof createInMemorySink>;

beforeEach(() => {
    memorySink = createInMemorySink();
    setTelemetrySink(memorySink);
});

afterEach(() => {
    __resetTelemetrySinkForTests();
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p15c-e2e-'));
    tempDirs.push(dir);
    return dir;
}

function eventTypes(events: readonly TelemetryEvent[]): string[] {
    return events.map((event) => event.type);
}

describe('P15c — usage + telemetry end-to-end wiring', () => {
    it('emits a model.completed event with NormalizedUsage after a conversation turn', async () => {
        const cwd = createTempDir();
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            providerFactory: async () => ({
                name: 'openai',
                model: 'gpt-4o',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'hello there' },
                        usage: {
                            promptTokens: 1_000_500,
                            completionTokens: 50,
                            totalTokens: 1_000_550,
                            cacheReadTokens: 500,
                        },
                    };
                },
            }),
        });

        const result = await agent.run('hi');
        expect(result).toBe('hello there');

        const modelEvents = memorySink.events.filter((event): event is Extract<TelemetryEvent, { type: 'model.completed' }> =>
            event.type === 'model.completed',
        );
        expect(modelEvents).toHaveLength(1);
        const modelEvent = modelEvents[0]!;
        expect(modelEvent.usage.provider).toBe('openai');
        expect(modelEvent.usage.model).toBe('gpt-4o');
        // input = promptTokens - cacheRead = 1_000_500 - 500 = 1_000_000
        expect(modelEvent.usage.input).toBe(1_000_000);
        expect(modelEvent.usage.output).toBe(50);
        expect(modelEvent.usage.cacheRead).toBe(500);
        expect(modelEvent.usage.costUsd).toBeGreaterThan(0);
        expect(modelEvent.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('emits tool.completed events alongside model.completed when the turn executes tools', async () => {
        const cwd = createTempDir();
        let turn = 0;
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            providerFactory: async () => ({
                name: 'openai',
                model: 'gpt-4o',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    turn += 1;
                    if (turn === 1) {
                        return {
                            finishReason: 'tool_calls' as const,
                            message: {
                                role: 'assistant' as const,
                                content: '',
                                toolCalls: [{
                                    id: 'call-1',
                                    name: 'list_files',
                                    arguments: JSON.stringify({ path: cwd, maxDepth: 1 }),
                                }],
                            },
                            usage: { promptTokens: 20, completionTokens: 4, totalTokens: 24 },
                        };
                    }
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'done' },
                        usage: { promptTokens: 30, completionTokens: 2, totalTokens: 32 },
                    };
                },
            }),
        });

        const result = await agent.run('list files');
        expect(result).toBe('done');

        const types = eventTypes(memorySink.events);
        expect(types.filter((t) => t === 'model.completed')).toHaveLength(2);
        expect(types).toContain('tool.completed');
        const toolEvent = memorySink.events.find((event): event is Extract<TelemetryEvent, { type: 'tool.completed' }> =>
            event.type === 'tool.completed',
        );
        expect(toolEvent?.name).toBe('list_files');
        expect(toolEvent?.success).toBe(true);
        expect(toolEvent?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('emits hook.completed events when lifecycle hooks are configured', async () => {
        const cwd = createTempDir();
        const hooks: HooksSettings = {
            SessionStart: [
                { hooks: [{ type: 'command', command: "cat >/dev/null; printf '%s' '{}'" }] },
            ],
        };

        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            hooks,
            providerFactory: async () => ({
                name: 'openai',
                model: 'gpt-4o',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'ok' },
                        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
                    };
                },
            }),
        });

        await agent.run('hi');

        const hookEvents = memorySink.events.filter((event): event is Extract<TelemetryEvent, { type: 'hook.completed' }> =>
            event.type === 'hook.completed',
        );
        expect(hookEvents.length).toBeGreaterThanOrEqual(1);
        const sessionStart = hookEvents.find((event) => event.event === 'SessionStart');
        expect(sessionStart).toBeDefined();
        expect(sessionStart!.decision).toBe('allow');
    });

    it('session.usage remains consistent with telemetry-reported totals', async () => {
        const cwd = createTempDir();
        const agent = new XQoderAgent({
            llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
            cwd,
            projectRoot: cwd,
            permissions: { defaultMode: 'allow', tools: {} },
            providerFactory: async () => ({
                name: 'openai',
                model: 'gpt-4o',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop' as const,
                        message: { role: 'assistant' as const, content: 'hi' },
                        usage: {
                            promptTokens: 200,
                            completionTokens: 20,
                            totalTokens: 220,
                            cacheReadTokens: 50,
                        },
                    };
                },
            }),
        });

        await agent.run('hello');

        const sessionUsage = (agent as unknown as { session: { getUsage(): { promptTokens: number; completionTokens: number; cacheReadTokens?: number } } }).session.getUsage();
        const modelEvent = memorySink.events.find((event): event is Extract<TelemetryEvent, { type: 'model.completed' }> =>
            event.type === 'model.completed',
        );
        expect(modelEvent).toBeDefined();
        // session.usage preserves the folded promptTokens (= input + cacheRead)
        expect(sessionUsage.promptTokens).toBe(modelEvent!.usage.input + (modelEvent!.usage.cacheRead ?? 0));
        expect(sessionUsage.completionTokens).toBe(modelEvent!.usage.output);
        expect(sessionUsage.cacheReadTokens).toBe(modelEvent!.usage.cacheRead);
    });
});
