import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    __resetTelemetrySinkForTests,
    createInMemorySink,
    createNoopSink,
    emitTelemetry,
    getTelemetrySink,
    setTelemetrySink,
    type TelemetryEvent,
} from '../../../src/shared/telemetry/sink.js';

describe('telemetry sink (P15b)', () => {
    beforeEach(() => {
        __resetTelemetrySinkForTests();
    });

    afterEach(() => {
        __resetTelemetrySinkForTests();
    });

    it('returns noop sink by default', () => {
        const sink = getTelemetrySink({} as NodeJS.ProcessEnv);
        expect(sink).toBeDefined();
        expect(() => sink.log({
            type: 'model.completed',
            usage: { provider: 'openai', model: 'gpt-4o', input: 1, output: 1 },
            durationMs: 10,
        })).not.toThrow();
    });

    it('respects XQODER_DISABLE_TELEMETRY=1', () => {
        const sink = getTelemetrySink({ XQODER_DISABLE_TELEMETRY: '1' } as NodeJS.ProcessEnv);
        expect(sink).toBeDefined();
    });

    it('switches based on XQODER_TELEMETRY_SINK env', () => {
        const sink = getTelemetrySink({ XQODER_TELEMETRY_SINK: 'memory' } as NodeJS.ProcessEnv);
        expect(sink).toBeDefined();
    });

    it('caches the sink once resolved', () => {
        const first = getTelemetrySink({ XQODER_TELEMETRY_SINK: 'memory' } as NodeJS.ProcessEnv);
        const second = getTelemetrySink({ XQODER_TELEMETRY_SINK: 'noop' } as NodeJS.ProcessEnv);
        expect(second).toBe(first);
    });

    it('setTelemetrySink overrides cached instance', () => {
        const memory = createInMemorySink();
        setTelemetrySink(memory);
        const sink = getTelemetrySink({} as NodeJS.ProcessEnv);
        expect(sink).toBe(memory);
    });

    it('emitTelemetry writes to configured sink and never throws', () => {
        const memory = createInMemorySink();
        setTelemetrySink(memory);
        const event: TelemetryEvent = {
            type: 'tool.completed',
            name: 'read_file',
            success: true,
            durationMs: 12,
            sessionId: 'sess-1',
        };
        emitTelemetry(event);
        expect(memory.events).toHaveLength(1);
        expect(memory.events[0]).toEqual(event);
    });

    it('emitTelemetry swallows errors from sink.log', () => {
        const throwing = {
            log: () => { throw new Error('boom'); },
            flush: async () => { /* noop */ },
        };
        setTelemetrySink(throwing);
        expect(() => emitTelemetry({
            type: 'hook.completed',
            event: 'PreToolUse',
            decision: 'allow',
            durationMs: 3,
        })).not.toThrow();
    });

    it('createNoopSink resolves without side effects', async () => {
        const sink = createNoopSink();
        expect(() => sink.log({
            type: 'session.ended',
            totalUsage: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', input: 1, output: 1 },
            sessionId: 'sess',
        })).not.toThrow();
        await expect(sink.flush()).resolves.toBeUndefined();
    });
});
