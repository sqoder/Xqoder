import { describe, expect, it } from 'vitest';
import { getLspUiPlaceholder, parseLspUiSubmission } from './lsp-ui.js';

describe('lsp ui helpers', () => {
    it('parses hover/completion positions', () => {
        expect(parseLspUiSubmission('hover', '4:11')).toEqual({
            line: 4,
            character: 11,
        });
        expect(parseLspUiSubmission('completion', '10:3')).toEqual({
            line: 10,
            character: 3,
        });
    });

    it('parses rename positions with new symbol name', () => {
        expect(parseLspUiSubmission('rename', '4:11 welcomeUser')).toEqual({
            line: 4,
            character: 11,
            newName: 'welcomeUser',
        });
    });

    it('returns mode specific placeholders', () => {
        expect(getLspUiPlaceholder('hover')).toContain('4:11');
        expect(getLspUiPlaceholder('completion')).toContain('resolve');
        expect(getLspUiPlaceholder('rename')).toContain('welcomeUser');
    });
});
