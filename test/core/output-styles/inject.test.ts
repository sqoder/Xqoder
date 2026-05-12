import { describe, expect, it } from 'bun:test';
import { appendOutputStyleTail } from '../../../src/core/output-styles/inject.js';
import type { OutputStyleFile } from '../../../src/core/output-styles/load-dir.js';

function style(partial: Partial<OutputStyleFile> & { name: string }): OutputStyleFile {
    return {
        name: partial.name,
        description: partial.description ?? 'style desc',
        systemPromptAppend: partial.systemPromptAppend,
        responseFormat: partial.responseFormat,
        filePath: partial.filePath ?? `/virtual/${partial.name}.md`,
    };
}

describe('appendOutputStyleTail', () => {
    it('returns original prompt when style is undefined', () => {
        expect(appendOutputStyleTail('base prompt', undefined)).toBe('base prompt');
    });

    it('appends systemPromptAppend as a separate block', () => {
        const s = style({ name: 'concise', systemPromptAppend: 'Be terse.' });
        const out = appendOutputStyleTail('base prompt', s);
        expect(out).toContain('base prompt');
        expect(out).toContain('Be terse.');
        expect(out.split('\n\n').length).toBeGreaterThanOrEqual(2);
    });

    it('marks the style tail so downstream parsers can strip it', () => {
        const s = style({ name: 'concise', systemPromptAppend: 'Be terse.' });
        const out = appendOutputStyleTail('base', s);
        expect(out).toMatch(/\[OutputStyle=concise\]/);
    });

    it('is a no-op when the style has no systemPromptAppend', () => {
        const s = style({ name: 'empty' });
        expect(appendOutputStyleTail('base', s)).toBe('base');
    });
});
