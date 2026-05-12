import { describe, expect, it } from 'bun:test';
import {
    containsThinking,
    extractThinking,
} from '../../../src/shared/thinking/token-extractor.js';

describe('extractThinking (P20a)', () => {
    it('returns empty strings for empty input', () => {
        expect(extractThinking('')).toEqual({ visible: '', thinking: '' });
    });

    it('splits <think>...</think> into thinking bucket', () => {
        const input = 'Hello <think>plan step</think> world';
        const result = extractThinking(input);
        expect(result.visible).toBe('Hello  world');
        expect(result.thinking).toBe('plan step');
    });

    it('handles multiple thinking blocks', () => {
        const input = 'a <think>first</think> b <reasoning>second</reasoning> c';
        const result = extractThinking(input);
        expect(result.visible).toBe('a  b  c');
        expect(result.thinking).toBe('firstsecond');
    });

    it('recognizes scratchpad and thought variants', () => {
        const input = '<scratchpad>x</scratchpad>visible<thought>y</thought>tail';
        const result = extractThinking(input);
        expect(result.visible).toBe('visibletail');
        expect(result.thinking).toBe('xy');
    });

    it('treats trailing content after open tag as thinking', () => {
        const input = 'visible <think>unterminated';
        const result = extractThinking(input);
        expect(result.visible).toBe('visible ');
        expect(result.thinking).toBe('unterminated');
    });

    it('keeps orphan close tags verbatim in visible', () => {
        const input = 'foo</think>bar';
        const result = extractThinking(input);
        expect(result.visible).toBe('foo</think>bar');
        expect(result.thinking).toBe('');
    });

    it('is case-insensitive on tag names', () => {
        const input = 'a<THINK>secret</THINK>b';
        const result = extractThinking(input);
        expect(result.visible).toBe('ab');
        expect(result.thinking).toBe('secret');
    });

    it('tolerates attributes and whitespace inside the tag syntax', () => {
        const input = 'x< think >hidden</ think >y';
        const result = extractThinking(input);
        expect(result.visible).toBe('xy');
        expect(result.thinking).toBe('hidden');
    });

    it('leaves text without thinking tags unchanged', () => {
        const input = 'just plain prose with <em>html-ish</em> tags';
        const result = extractThinking(input);
        expect(result.visible).toBe(input);
        expect(result.thinking).toBe('');
    });
});

describe('containsThinking (P20a)', () => {
    it('detects open tag presence', () => {
        expect(containsThinking('plain')).toBe(false);
        expect(containsThinking('<think>x</think>')).toBe(true);
        expect(containsThinking('<THINKING>x')).toBe(true);
        expect(containsThinking('<reasoning> ...')).toBe(true);
    });
});
