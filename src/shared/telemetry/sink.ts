// P15b — Telemetry sink abstraction.
//
// Every model call, tool call, and hook dispatch should send exactly one
// telemetry event. The sink is pluggable so we can wire a real destination
// (Datadog, OTLP, etc.) without changing call sites. Default is a noop sink.
//
// Discovery: `getTelemetrySink()` caches the sink per-process. Reset only
// in tests via `__resetTelemetrySinkForTests()`.

import type { NormalizedUsage } from './normalized-usage.js';

export type HookLifecycleName =
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PostToolUseFailure'
    | 'UserPromptSubmit'
    | 'SessionStart'
    | 'SessionEnd'
    | 'Stop'
    | 'SubagentStop'
    | 'PreCompact'
    | 'PostCompact';

export type TelemetryEvent =
    | {
        readonly type: 'model.completed';
        readonly usage: NormalizedUsage;
        readonly durationMs: number;
        readonly sessionId?: string;
    }
    | {
        readonly type: 'tool.completed';
        readonly name: string;
        readonly success: boolean;
        readonly durationMs: number;
        readonly sessionId?: string;
    }
    | {
        readonly type: 'hook.completed';
        readonly event: HookLifecycleName;
        readonly decision: string;
        readonly durationMs: number;
        readonly sessionId?: string;
    }
    | {
        readonly type: 'session.ended';
        readonly totalUsage: NormalizedUsage;
        readonly sessionId: string;
    };

export interface TelemetrySink {
    log(event: TelemetryEvent): void;
    flush(): Promise<void>;
}

export function createNoopSink(): TelemetrySink {
    return {
        log: () => {
            // intentionally empty
        },
        flush: async () => {
            // intentionally empty
        },
    };
}

/**
 * In-memory sink for tests. Keeps every event in order; `flush()` is a noop.
 */
export function createInMemorySink(): TelemetrySink & { readonly events: readonly TelemetryEvent[] } {
    const events: TelemetryEvent[] = [];
    return {
        events,
        log: (event) => {
            events.push(event);
        },
        flush: async () => {
            // intentionally empty
        },
    };
}

/**
 * Datadog sink stub. Writes events to stderr when XQODER_TELEMETRY_DATADOG_DEBUG=1;
 * otherwise silently drops them. Real HTTP submission is wired in P15c only if
 * the user opts into a proper endpoint. This stub keeps `getTelemetrySink()`
 * returning a concrete object so callers don't need null checks.
 */
export function createDatadogSinkStub(): TelemetrySink {
    const debug = process.env['XQODER_TELEMETRY_DATADOG_DEBUG'] === '1';
    return {
        log: (event) => {
            if (debug) {
                process.stderr.write(`[datadog-stub] ${JSON.stringify(event)}\n`);
            }
        },
        flush: async () => {
            // intentionally empty
        },
    };
}

let cachedSink: TelemetrySink | undefined;

export function getTelemetrySink(env: NodeJS.ProcessEnv = process.env): TelemetrySink {
    if (cachedSink) {
        return cachedSink;
    }
    if (env['XQODER_DISABLE_TELEMETRY'] === '1') {
        cachedSink = createNoopSink();
        return cachedSink;
    }
    const choice = env['XQODER_TELEMETRY_SINK']?.trim().toLowerCase();
    switch (choice) {
        case 'datadog':
            cachedSink = createDatadogSinkStub();
            break;
        case 'memory':
            cachedSink = createInMemorySink();
            break;
        case 'noop':
        case '':
        case undefined:
        default:
            cachedSink = createNoopSink();
            break;
    }
    return cachedSink;
}

export function setTelemetrySink(sink: TelemetrySink | undefined): void {
    cachedSink = sink;
}

export function __resetTelemetrySinkForTests(): void {
    cachedSink = undefined;
}

/**
 * Helper: safely log to the ambient sink, swallowing any internal failures so
 * telemetry never takes down the host runtime.
 */
export function emitTelemetry(event: TelemetryEvent): void {
    try {
        getTelemetrySink().log(event);
    } catch {
        // telemetry must not propagate
    }
}
