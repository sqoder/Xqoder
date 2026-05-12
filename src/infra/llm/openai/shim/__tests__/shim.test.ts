// Behavior tests for the OpenAI shim pure utilities.
// Covers convertMessages, convertTools, ThinkTagFilter, normalizeToolArguments,
// repairPossiblyTruncatedObjectJson, and openaiStreamToInternal.
// ≥ 20 assertions in total (see DoD in phase-05-openai-shim.md).

import { describe, expect, it } from 'bun:test';
import type { LLMMessage, ToolCall, ToolDefinition } from '@xqoder/shared';
import {
    ThinkTagFilter,
    convertMessages,
    convertTools,
    normalizeSchemaForOpenAI,
    normalizeToolArguments,
    openaiStreamToInternal,
    repairPossiblyTruncatedObjectJson,
    type OpenAIStreamChunk,
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

describe('convertMessages', () => {
    it('passes system/user messages through unchanged', () => {
        const out = convertMessages([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
        ]);
        expect(out).toEqual([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
        ]);
    });

    it('maps assistant tool_calls into OpenAI tool_calls shape', () => {
        const toolCalls: ToolCall[] = [{ id: 'call_1', name: 'run_shell', arguments: '{"command":"ls"}' }];
        const out = convertMessages([{ role: 'assistant', content: '', toolCalls }]);
        expect(out[0]).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: { name: 'run_shell', arguments: '{"command":"ls"}' },
            }],
        });
    });

    it('keeps assistant text when tool_calls + content coexist', () => {
        const out = convertMessages([
            { role: 'assistant', content: 'thinking about it', toolCalls: [{ id: 'c', name: 'n', arguments: '{}' }] },
        ]);
        expect(out[0]).toMatchObject({ content: 'thinking about it' });
    });

    it('maps tool role into tool_call_id shape', () => {
        const out = convertMessages([
            { role: 'tool', content: 'result', toolCallId: 'call_42' } as LLMMessage,
        ]);
        expect(out[0]).toEqual({ role: 'tool', content: 'result', tool_call_id: 'call_42' });
    });

    it('preserves empty tool_call_id as empty string rather than dropping field', () => {
        const out = convertMessages([
            { role: 'tool', content: 'x' } as LLMMessage,
        ]);
        expect(out[0]).toMatchObject({ tool_call_id: '' });
    });
});

describe('convertTools + normalizeSchemaForOpenAI', () => {
    const tool: ToolDefinition = {
        name: 'search',
        description: 'search the web',
        parameters: [
            { name: 'query', type: 'string', description: 'q', required: true },
            { name: 'limit', type: 'number', description: 'n', required: false },
        ],
    };

    it('adds additionalProperties:false and strict flag in strict mode', () => {
        const [out] = convertTools([tool], { strict: true });
        expect(out?.function.parameters.additionalProperties).toBe(false);
        expect(out?.function.strict).toBe(true);
    });

    it('keeps only declared required fields under strict', () => {
        const [out] = convertTools([tool], { strict: true });
        expect(out?.function.parameters.required).toEqual(['query']);
        expect(Object.keys(out?.function.parameters.properties ?? {})).toEqual(['query', 'limit']);
    });

    it('omits strict flag when not in strict mode', () => {
        const [out] = convertTools([tool]);
        expect(out?.function.strict).toBeUndefined();
    });

    it('recursively sanitizes nested object schemas', () => {
        const nested = normalizeSchemaForOpenAI({
            type: 'object',
            properties: {
                outer: {
                    type: 'object',
                    properties: { inner: { type: 'string' } },
                    required: ['inner'],
                },
            },
            required: ['outer'],
        }, { strict: true });
        const outer = (nested.properties as Record<string, { additionalProperties?: boolean }>).outer;
        expect(outer?.additionalProperties).toBe(false);
    });

    it('stringifies non-string enum values', () => {
        const out = normalizeSchemaForOpenAI({
            type: 'string',
            enum: ['a', 1, true],
        });
        expect(out.enum).toEqual(['a', '1', 'true']);
    });
});

describe('ThinkTagFilter', () => {
    it('strips a single-chunk <think>...</think>', () => {
        const f = new ThinkTagFilter();
        expect(f.push('hi<think>secret</think>world')).toBe('hiworld');
        expect(f.flush()).toBe('');
    });

    it('strips a think block split across multiple chunks', () => {
        const f = new ThinkTagFilter();
        let out = '';
        out += f.push('he');
        out += f.push('llo <thi');
        out += f.push('nking>hidden</thi');
        out += f.push('nking> tail');
        out += f.flush();
        expect(out).toBe('hello  tail');
    });

    it('does not leak an opening tag into output when chunks are ragged', () => {
        const f = new ThinkTagFilter();
        const out = f.push('prefix <th');
        expect(out).toBe('prefix ');
        expect(f.flush()).toBe('<th');
    });

    it('flush returns empty when dangling inside a think block', () => {
        const f = new ThinkTagFilter();
        f.push('<think>unterminated');
        expect(f.flush()).toBe('');
    });
});

describe('normalizeToolArguments', () => {
    it('passes through valid JSON objects unchanged', () => {
        expect(normalizeToolArguments('run_shell', '{"command":"ls"}')).toEqual({ command: 'ls' });
    });

    it('boxes a plain shell command string into {command}', () => {
        expect(normalizeToolArguments('run_shell', 'ls -la')).toEqual({ command: 'ls -la' });
    });

    it('auto-boxes single-string-parameter schemas by key', () => {
        const out = normalizeToolArguments('search', 'neural networks', {
            properties: { query: { type: 'string' } },
        });
        expect(out).toEqual({ query: 'neural networks' });
    });

    it('repairs a truncated JSON object and accepts it', () => {
        const out = normalizeToolArguments('any', '{"a":"hello"');
        expect(out).toEqual({ a: 'hello' });
    });

    it('throws when shape is unrecoverable and no fallback applies', () => {
        expect(() => normalizeToolArguments('unknown', '??not json??')).toThrow();
    });
});

describe('repairPossiblyTruncatedObjectJson', () => {
    it('closes a simple truncated object', () => {
        expect(repairPossiblyTruncatedObjectJson('{"a":"hello"')).toBe('{"a":"hello"}');
    });

    it('closes a truncated array', () => {
        expect(repairPossiblyTruncatedObjectJson('[1,2,')).toBe('[1,2]');
    });

    it('fills dangling colon with empty string literal', () => {
        const repaired = repairPossiblyTruncatedObjectJson('{"k":');
        expect(JSON.parse(repaired)).toEqual({ k: '' });
    });

    it('ignores braces inside strings when balancing', () => {
        const repaired = repairPossiblyTruncatedObjectJson('{"s":"has }{"');
        expect(JSON.parse(repaired)).toEqual({ s: 'has }{' });
    });
});

describe('openaiStreamToInternal', () => {
    it('accumulates content deltas and emits onToken', async () => {
        const tokens: string[] = [];
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { content: 'Hel' } }] },
            { choices: [{ delta: { content: 'lo' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), { onToken: (t) => tokens.push(t) });
        expect(tokens.join('')).toBe('Hello');
        expect(res.message.content).toBe('Hello');
        expect(res.finishReason).toBe('stop');
    });

    it('filters <think> tags through ThinkTagFilter', async () => {
        const tokens: string[] = [];
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { content: 'a<think>hidden</think>b' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), { onToken: (t) => tokens.push(t) }, { thinkTagFilter: new ThinkTagFilter() });
        expect(tokens.join('')).toBe('ab');
        expect(res.message.content).toBe('ab');
    });

    it('accumulates fragmented tool_call arguments into a single ToolCall', async () => {
        const calls: ToolCall[] = [];
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_shell', arguments: '{"comm' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), { onToolCall: (tc) => calls.push(tc) });
        expect(calls).toEqual([{ id: 'c1', name: 'run_shell', arguments: '{"command":"ls"}' }]);
        expect(res.finishReason).toBe('tool_calls');
        expect(res.message.toolCalls).toBeDefined();
    });

    it('routes reasoning_content deltas to onThinkingToken', async () => {
        const thinkingTokens: string[] = [];
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { reasoning_content: 'thinking...' } }] },
            { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), { onThinkingToken: (t) => thinkingTokens.push(t) });
        expect(thinkingTokens).toEqual(['thinking...']);
        expect(res.message.thinking).toBe('thinking...');
        expect(res.message.content).toBe('answer');
    });

    it('propagates usage totals from the final chunk', async () => {
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] },
            { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), {});
        expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    });

    it('survives a callback that throws without breaking the stream', async () => {
        const chunks: OpenAIStreamChunk[] = [
            { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
        ];
        const res = await openaiStreamToInternal(asyncIterable(chunks), {
            onToken: () => { throw new Error('boom'); },
        });
        expect(res.message.content).toBe('ok');
    });
});
