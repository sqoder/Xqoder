import { describe, expect, it } from 'bun:test';
import {
    applyTextEditsToContent,
    clampResolveLimit,
    clampResultLimit,
    parseBooleanArg,
} from '../../src/core/agent/tools/lsp-tool-typescript-context.js';

describe('lsp tool TypeScript context helpers', () => {
    it('applies multiple text edits in reverse-offset order', () => {
        const updated = applyTextEditsToContent('const alpha = beta;\n', [
            {
                filePath: '/workspace/example.ts',
                startLine: 1,
                startCharacter: 7,
                endLine: 1,
                endCharacter: 12,
                newText: 'gamma',
            },
            {
                filePath: '/workspace/example.ts',
                startLine: 1,
                startCharacter: 15,
                endLine: 1,
                endCharacter: 19,
                newText: 'delta',
            },
        ]);

        expect(updated).toBe('const gamma = delta;\n');
    });

    it('normalizes numeric and boolean arguments', () => {
        expect(clampResultLimit(200)).toBe(50);
        expect(clampResultLimit('nan')).toBe(20);
        expect(clampResolveLimit(99)).toBe(10);
        expect(clampResolveLimit('oops')).toBe(5);
        expect(parseBooleanArg(true)).toBe(true);
        expect(parseBooleanArg('YES')).toBe(true);
        expect(parseBooleanArg('off')).toBe(false);
    });
});
