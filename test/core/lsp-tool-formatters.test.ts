import { describe, expect, it } from 'bun:test';
import {
    formatCompletionMatch,
    formatHoverMatch,
    formatSymbolMatch,
} from '../../src/core/agent/tools/lsp-tool-formatters.js';

describe('lsp tool formatters', () => {
    it('formats workspace symbols with container information', () => {
        expect(formatSymbolMatch({
            kind: 'function',
            name: 'alpha',
            filePath: '/workspace/example.ts',
            line: 3,
            character: 14,
            preview: 'function alpha() {}',
            containerName: 'Example > nested',
        })).toBe('- function alpha  /workspace/example.ts:3:14  container=Example > nested  function alpha() {}');
    });

    it('formats resolved completion items and hover ranges', () => {
        expect(formatCompletionMatch({
            label: 'alpha',
            kind: 'function',
            resolved: true,
            detail: 'fn alpha(): string',
            insertText: 'alpha()',
            documentation: 'Returns alpha',
        })).toBe('- alpha [function] [resolved]  fn alpha(): string  insert=alpha()  Returns alpha');

        expect(formatHoverMatch({
            contents: '```ts\\nconst alpha: string\\n```',
            range: {
                line: 4,
                character: 2,
                endLine: 4,
                endCharacter: 7,
            },
        })).toBe('range=4:2-4:7\n```ts\\nconst alpha: string\\n```');
    });
});
