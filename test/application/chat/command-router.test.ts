import { describe, expect, it } from 'bun:test';
import {
    isDirectChatCommandRoute,
    resolveChatCommandRoute,
} from '../../../src/application/chat/index.js';

describe('chat command router — Slice 12', () => {
    it.each([
        ['/model', 'model'],
        ['/doctor', 'doctor'],
        ['/cost', 'cost'],
        ['/agents', 'agents'],
        ['/mcp', 'mcp'],
        ['/memory', 'memory'],
        ['/help', 'help'],
        ['/?', 'help'],
    ])('routes %s to the %s direct command', (prompt, kind) => {
        const route = resolveChatCommandRoute(prompt);
        expect(route.kind).toBe(kind as typeof route.kind);
        expect(isDirectChatCommandRoute(route)).toBe(true);
    });

    it('tolerates trailing arguments on info commands without entering the model', () => {
        const route = resolveChatCommandRoute('/model gpt-5-large');
        expect(route.kind).toBe('model');
        expect(isDirectChatCommandRoute(route)).toBe(true);
    });

    it('keeps existing /status and /plan routing intact after slice 12', () => {
        expect(resolveChatCommandRoute('/status').kind).toBe('status');
        expect(resolveChatCommandRoute('/plan rewrite parser').kind).toBe('workflow');
        expect(resolveChatCommandRoute('foo bar baz').kind).toBe('none');
    });
});
