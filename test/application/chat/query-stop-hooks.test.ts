// P09 sub-PR 2: query-stop-hooks unit tests.

import { describe, expect, it } from 'bun:test';
import type { ToolCall } from '@xqoder/shared';
import {
    createBlockedContinuationFingerprint,
    createToolCallBatchFingerprint,
    describeToolCallBatch,
    detectDuplicateToolBatch,
    detectNoProgressOnBlocker,
    normalizeContinuationField,
    normalizeToolArguments,
    resolveForcedStopDirective,
    resolvePermissionDeniedStopMessage,
} from '../../../src/application/chat/query-stop-hooks.js';

function call(name: string, args: string, id = 'call_1'): ToolCall {
    return { id, name, arguments: args };
}

describe('normalizeToolArguments', () => {
    it('returns "{}" for empty/blank input', () => {
        expect(normalizeToolArguments(undefined)).toBe('{}');
        expect(normalizeToolArguments('')).toBe('{}');
        expect(normalizeToolArguments('   ')).toBe('{}');
    });

    it('canonicalises JSON by sorting keys', () => {
        expect(normalizeToolArguments('{"b":2,"a":1}')).toBe('{"a":1,"b":2}');
    });

    it('falls back to trimmed text when JSON parsing fails', () => {
        expect(normalizeToolArguments('  not json  ')).toBe('not json');
    });
});

describe('createToolCallBatchFingerprint', () => {
    it('is insensitive to JSON key ordering', () => {
        const first = [call('read_file', '{"path":"a","line":1}')];
        const second = [call('read_file', '{"line":1,"path":"a"}')];
        expect(createToolCallBatchFingerprint(first)).toBe(createToolCallBatchFingerprint(second));
    });

    it('distinguishes different tool names', () => {
        const a = createToolCallBatchFingerprint([call('read_file', '{}')]);
        const b = createToolCallBatchFingerprint([call('run_shell', '{}')]);
        expect(a).not.toBe(b);
    });

    it('preserves batch order (different ordering → different fingerprint)', () => {
        const ab = createToolCallBatchFingerprint([call('a', '{}'), call('b', '{}')]);
        const ba = createToolCallBatchFingerprint([call('b', '{}'), call('a', '{}')]);
        expect(ab).not.toBe(ba);
    });
});

describe('describeToolCallBatch', () => {
    it('renders call name and normalised arguments', () => {
        const rendered = describeToolCallBatch([call('read_file', '{"path":"x"}')]);
        expect(rendered).toBe('read_file({"path":"x"})');
    });
});

describe('detectDuplicateToolBatch', () => {
    it('reports no stop when fingerprint differs', () => {
        const directive = detectDuplicateToolBatch({
            toolCalls: [call('read_file', '{}')],
            lastFingerprint: 'other:{}',
        });
        expect(directive).toBeUndefined();
    });

    it('reports duplicate_tool_call when fingerprint matches the last one', () => {
        const toolCalls = [call('read_file', '{"path":"a"}')];
        const lastFingerprint = createToolCallBatchFingerprint(toolCalls);
        const directive = detectDuplicateToolBatch({ toolCalls, lastFingerprint });
        expect(directive).toEqual({
            stopReason: 'duplicate_tool_call',
            message: 'Duplicate tool call batch detected: read_file({"path":"a"})',
            agentEndReason: 'failed',
        });
    });
});

describe('normalizeContinuationField', () => {
    it('collapses whitespace and trims', () => {
        expect(normalizeContinuationField('  a\t b\n c  ')).toBe('a b c');
    });

    it('handles undefined', () => {
        expect(normalizeContinuationField(undefined)).toBe('');
    });
});

describe('createBlockedContinuationFingerprint', () => {
    it('is stable across inner whitespace variations', () => {
        const a = createBlockedContinuationFingerprint('need to read', 'assistant\n  reply');
        const b = createBlockedContinuationFingerprint('need to   read', 'assistant reply');
        expect(a).toBe(b);
    });
});

describe('detectNoProgressOnBlocker', () => {
    it('reports no stop when the continuation fingerprint changed', () => {
        const directive = detectNoProgressOnBlocker({
            blocker: 'finish the task',
            assistantContent: 'working on it',
            lastFingerprint: 'old::old',
            stopReason: 'no_progress',
        });
        expect(directive).toBeUndefined();
    });

    it('reports no_progress when the continuation repeats', () => {
        const blocker = 'finish the task';
        const assistantContent = 'same reply';
        const lastFingerprint = createBlockedContinuationFingerprint(blocker, assistantContent);
        const directive = detectNoProgressOnBlocker({
            blocker,
            assistantContent,
            lastFingerprint,
            stopReason: 'no_progress',
        });
        expect(directive).toEqual({
            stopReason: 'no_progress',
            message: 'No progress detected while waiting on blocker: finish the task',
            agentEndReason: 'failed',
        });
    });

    it('propagates verification_failed stopReason when caller requests it', () => {
        const blocker = 'tests still red';
        const content = 'retrying';
        const lastFingerprint = createBlockedContinuationFingerprint(blocker, content);
        const directive = detectNoProgressOnBlocker({
            blocker,
            assistantContent: content,
            lastFingerprint,
            stopReason: 'verification_failed',
        });
        expect(directive?.stopReason).toBe('verification_failed');
    });
});

describe('resolveForcedStopDirective', () => {
    it('returns undefined when no runtime is supplied', () => {
        expect(resolveForcedStopDirective(undefined)).toBeUndefined();
    });

    it('prefers getForcedStopDirective when available', () => {
        const directive = resolveForcedStopDirective({
            getForcedStopDirective: () => ({ stopReason: 'max_turns', message: 'stopped' }),
            getForcedStopMessage: () => 'ignored',
        });
        expect(directive).toEqual({ stopReason: 'max_turns', message: 'stopped' });
    });

    it('falls back to legacy message and classifies as max_wall_time when it says "timeout"', () => {
        const directive = resolveForcedStopDirective({
            getForcedStopMessage: () => 'operation timeout',
        });
        expect(directive).toEqual({ stopReason: 'max_wall_time', message: 'operation timeout' });
    });

    it('defaults the legacy message to max_turns', () => {
        const directive = resolveForcedStopDirective({
            getForcedStopMessage: () => 'giving up',
        });
        expect(directive).toEqual({ stopReason: 'max_turns', message: 'giving up' });
    });

    it('returns undefined when neither hook is implemented', () => {
        expect(resolveForcedStopDirective({})).toBeUndefined();
    });
});

describe('resolvePermissionDeniedStopMessage', () => {
    it('returns undefined when no execution was denied', () => {
        expect(
            resolvePermissionDeniedStopMessage([
                { name: 'read_file', stopReason: 'completed', toolHistoryEntry: { error: 'n/a' } },
            ]),
        ).toBeUndefined();
    });

    it('prefers the recorded error message when present', () => {
        const msg = resolvePermissionDeniedStopMessage([
            {
                name: 'run_shell',
                stopReason: 'permission_denied',
                toolHistoryEntry: { error: 'blocked by sandbox' },
            },
        ]);
        expect(msg).toBe('blocked by sandbox');
    });

    it('falls back to a canonical deny message when no error is recorded', () => {
        const msg = resolvePermissionDeniedStopMessage([
            { name: 'delete_file', stopReason: 'permission_denied' },
        ]);
        expect(msg).toBe('Tool "delete_file" was denied by the active permission policy');
    });
});
