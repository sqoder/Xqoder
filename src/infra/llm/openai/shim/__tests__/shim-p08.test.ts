// P08 behavior tests for the OpenAI shim additions.
// Covers compressToolHistory, codex-shim (buildCodexInput, codexStreamToInternal),
// ThinkTagFilter v2 (reasoning/thought + onThinking), and schema-aware
// normalizeToolArguments.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage, ToolCall } from '@xqoder/shared';
import {
    ThinkTagFilter,
    buildCodexInput,
    codexStreamToInternal,
    compressToolHistory,
    normalizeToolArguments,
    type CodexStreamEvent,
} from '../index.js';

function asyncIterable<T>(values: T[]): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            let i = 0;
            return {
                async next() {
                    if (i >= values.length) return { value: undefined, done: true };
                    return { value: values[i++] as T, done: false };
                },
            };
        },
    };
}

function buildPairs(count: number): LLMMessage[] {
    const out: LLMMessage[] = [];
    for (let i = 0; i < count; i++) {
        const callId = `call_${i}`;
        out.push({
            role: 'assistant',
            content: '',
            toolCalls: [{ id: callId, name: i % 2 === 0 ? 'run_shell' : 'read_file', arguments: '{}' }],
        });
        out.push({
            role: 'tool',
            content: `result ${i}`,
            toolCallId: callId,
        });
    }
    return out;
}

describe('compressToolHistory', () => {
    it('returns input unchanged when pair count ≤ keepRecent', () => {
        const msgs = buildPairs(4);
        expect(compressToolHistory(msgs)).toBe(msgs);
    });

    it('folds 30 pairs down to 6 verbatim pairs + 1 summary', () => {
        const msgs = buildPairs(30);
        const out = compressToolHistory(msgs, { keepRecent: 6 });
        const summaries = out.filter((m) => m.role === 'system');
        const assistantMsgs = out.filter((m) => m.role === 'assistant' && m.toolCalls);
        const toolResults = out.filter((m) => m.role === 'tool');
        expect(summaries.length).toBe(1);
        expect(assistantMsgs.length).toBe(6);
        expect(toolResults.length).toBe(6);
        const summary = summaries[0]!.content;
        expect(summary.split('\n').length).toBe(24);
        expect(summary).toContain('[compressed run_shell → ok');
        expect(summary).toContain('[compressed read_file → ok');
    });

    it('marks tool results beginning with Error: as fail in the summary', () => {
        const msgs: LLMMessage[] = [];
        for (let i = 0; i < 8; i++) {
            msgs.push({
                role: 'assistant',
                content: '',
                toolCalls: [{ id: `c${i}`, name: 'run_shell', arguments: '{}' }],
            });
            msgs.push({
                role: 'tool',
                content: i === 0 ? 'Error: boom' : 'ok',
                toolCallId: `c${i}`,
            });
        }
        const out = compressToolHistory(msgs, { keepRecent: 6 });
        const summary = out.find((m) => m.role === 'system')!.content;
        expect(summary).toContain('→ fail');
    });

    it('leaves incomplete pairs in the tail and keeps their order', () => {
        const msgs: LLMMessage[] = [
            ...buildPairs(8),
            // incomplete pair: assistant tool_call with no matching tool result
            { role: 'assistant', content: '', toolCalls: [{ id: 'orphan', name: 'n', arguments: '{}' }] },
        ];
        const out = compressToolHistory(msgs, { keepRecent: 6 });
        expect(out[out.length - 1]).toEqual({
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'orphan', name: 'n', arguments: '{}' }],
        });
    });
});

describe('ThinkTagFilter v2', () => {
    it('strips a <reasoning>…</reasoning> block', () => {
        const f = new ThinkTagFilter();
        const out = f.push('a<reasoning>hidden</reasoning>b');
        expect(out).toBe('ab');
        expect(f.flush()).toBe('');
    });

    it('strips a <thought>…</thought> block', () => {
        const f = new ThinkTagFilter();
        const out = f.push('x<thought>hidden</thought>y');
        expect(out).toBe('xy');
    });

    it('forwards tag-internal text to onThinking when provided', () => {
        const parts: string[] = [];
        const f = new ThinkTagFilter({ onThinking: (t) => parts.push(t) });
        f.push('pre<think>reasoning step 1</think>post');
        f.push(' <thinking>step 2</thinking>');
        expect(parts.join('')).toBe('reasoning step 1step 2');
    });

    it('forwards split-chunk reasoning across pushes to onThinking', () => {
        const parts: string[] = [];
        const f = new ThinkTagFilter({ onThinking: (t) => parts.push(t) });
        f.push('hi <reason');
        f.push('ing>part ');
        f.push('one ');
        f.push('two</reasoning> tail');
        expect(parts.join('')).toBe('part one two');
    });
});

describe('normalizeToolArguments (schema-aware)', () => {
    it('coerces string numbers into number type per schema', () => {
        const out = normalizeToolArguments('set_limit', '{"limit":"42"}', {
            properties: { limit: { type: 'number' } },
            required: ['limit'],
        });
        expect(out).toEqual({ limit: 42 });
    });

    it('fills optional default when key is missing', () => {
        const out = normalizeToolArguments('search', '{"q":"foo"}', {
            properties: {
                q: { type: 'string' },
                limit: { type: 'number', default: 10 },
            },
            required: ['q'],
        });
        expect(out).toEqual({ q: 'foo', limit: 10 });
    });

    it('drops extra keys not declared in the schema', () => {
        const out = normalizeToolArguments('tool', '{"a":"1","extra":"nope"}', {
            properties: { a: { type: 'string' } },
            required: ['a'],
        });
        expect(out).toEqual({ a: '1' });
    });

    it('coerces "true"/"false" strings to booleans', () => {
        const out = normalizeToolArguments('set_flag', '{"on":"true","off":"false"}', {
            properties: {
                on: { type: 'boolean' },
                off: { type: 'boolean' },
            },
        });
        expect(out).toEqual({ on: true, off: false });
    });
});

describe('buildCodexInput', () => {
    it('merges all system messages into the first user turn', () => {
        const out = buildCodexInput([
            { role: 'system', content: 'rule 1' },
            { role: 'system', content: 'rule 2' },
            { role: 'user', content: 'what up' },
        ]);
        expect(out).toEqual([
            { role: 'user', content: 'rule 1\n\nrule 2\n\nwhat up' },
        ]);
    });

    it('prepends a standalone system-only message when there is no user turn', () => {
        const out = buildCodexInput([
            { role: 'system', content: 'only rules' },
            { role: 'assistant', content: 'ok' },
        ]);
        expect(out[0]).toEqual({ role: 'user', content: 'only rules' });
        expect(out[1]).toEqual({ role: 'assistant', content: 'ok' });
    });

    it('maps assistant tool_calls into function_call items', () => {
        const toolCalls: ToolCall[] = [
            { id: 'c1', name: 'run_shell', arguments: '{"command":"ls"}' },
        ];
        const out = buildCodexInput([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: '', toolCalls },
            { role: 'tool', content: 'file list', toolCallId: 'c1' },
        ]);
        expect(out).toEqual([
            { role: 'user', content: 'hi' },
            { type: 'function_call', call_id: 'c1', name: 'run_shell', arguments: '{"command":"ls"}' },
            { type: 'function_call_output', call_id: 'c1', output: 'file list' },
        ]);
    });
});

describe('codexStreamToInternal', () => {
    it('accumulates output_text.delta events into content + onToken', async () => {
        const tokens: string[] = [];
        const events: CodexStreamEvent[] = [
            { type: 'response.output_text.delta', delta: 'Hel' },
            { type: 'response.output_text.delta', delta: 'lo' },
            { type: 'response.completed' },
        ];
        const res = await codexStreamToInternal(asyncIterable(events), { onToken: (t) => tokens.push(t) });
        expect(tokens.join('')).toBe('Hello');
        expect(res.message.content).toBe('Hello');
        expect(res.finishReason).toBe('stop');
    });

    it('assembles a function_call from output_item.added + arguments.delta + done', async () => {
        const calls: ToolCall[] = [];
        const events: CodexStreamEvent[] = [
            {
                type: 'response.output_item.added',
                item: { id: 'it1', type: 'function_call', call_id: 'fc1', name: 'run_shell' },
            },
            { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"comm' },
            { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: 'and":"ls"}' },
            {
                type: 'response.output_item.done',
                item: { id: 'it1', type: 'function_call', call_id: 'fc1', name: 'run_shell', arguments: '{"command":"ls"}' },
            },
            { type: 'response.completed' },
        ];
        const res = await codexStreamToInternal(asyncIterable(events), { onToolCall: (tc) => calls.push(tc) });
        expect(calls).toEqual([{ id: 'fc1', name: 'run_shell', arguments: '{"command":"ls"}' }]);
        expect(res.finishReason).toBe('tool_calls');
    });

    it('routes reasoning_text deltas into onThinkingToken + message.thinking', async () => {
        const thinkingTokens: string[] = [];
        const events: CodexStreamEvent[] = [
            { type: 'response.reasoning_text.delta', delta: 'pondering...' },
            { type: 'response.output_text.delta', delta: 'answer' },
            { type: 'response.completed' },
        ];
        const res = await codexStreamToInternal(asyncIterable(events), { onThinkingToken: (t) => thinkingTokens.push(t) });
        expect(thinkingTokens).toEqual(['pondering...']);
        expect(res.message.thinking).toBe('pondering...');
        expect(res.message.content).toBe('answer');
    });

    it('maps Responses API usage (input/output_tokens) to internal shape', async () => {
        const events: CodexStreamEvent[] = [
            { type: 'response.output_text.delta', delta: 'hi' },
            {
                type: 'response.completed',
                response: { usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } },
            },
        ];
        const res = await codexStreamToInternal(asyncIterable(events), {});
        expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
    });
});
