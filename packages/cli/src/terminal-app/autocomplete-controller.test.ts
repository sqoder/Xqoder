import { describe, expect, it } from 'vitest';
import { AutocompleteController, resolveAutocompleteOverlayIntent } from './autocomplete-controller.js';

describe('AutocompleteController', () => {
    it('detects @ trigger and query near cursor', () => {
        const controller = new AutocompleteController();
        const result = controller.update('hello @src/fi', 'hello @src/fi'.length);
        expect(result).toEqual({ trigger: '@', query: 'src/fi' });
        expect(controller.getState()).toEqual({ trigger: '@', query: 'src/fi' });
    });

    it('detects / trigger and query near cursor', () => {
        const controller = new AutocompleteController();
        const result = controller.update('/sess', '/sess'.length);
        expect(result).toEqual({ trigger: '/', query: 'sess' });
    });

    it('closes trigger when query contains spaces', () => {
        const controller = new AutocompleteController();
        controller.update('@src', 4);
        const result = controller.update('@src file', '@src file'.length);
        expect(result).toBeNull();
        expect(controller.getState()).toEqual({ trigger: null, query: '' });
    });

    it('matches run-terminal-app-core trigger conditions for @src and /', () => {
        const controller = new AutocompleteController();

        const atResult = controller.update('@', 1);
        expect(resolveAutocompleteOverlayIntent('@', '', atResult)).toBe('open-complete');

        const afterAt = controller.update('@src', 4);
        expect(afterAt).toEqual({ trigger: '@', query: 'src' });
        expect(resolveAutocompleteOverlayIntent('s', '@', afterAt)).toBeNull();

        const slashResult = controller.update('/', 1);
        expect(resolveAutocompleteOverlayIntent('/', '', slashResult)).toBe('open-commands');
        expect(resolveAutocompleteOverlayIntent('/', 'x', slashResult)).toBeNull();
    });

    it('supports @ query updates when cursor edits in middle', () => {
        const controller = new AutocompleteController();
        const text = '@srx file';
        const cursor = 4; // after @srx, before space
        const result = controller.update(text, cursor);

        expect(result).toEqual({ trigger: '@', query: 'srx' });
        expect(resolveAutocompleteOverlayIntent('x', '@sr', result)).toBeNull();
    });

    it('supports / query updates when cursor edits in middle', () => {
        const controller = new AutocompleteController();
        const text = '/sesx run';
        const cursor = 5; // after /sesx, before space
        const result = controller.update(text, cursor);

        expect(result).toEqual({ trigger: '/', query: 'sesx' });
        expect(resolveAutocompleteOverlayIntent('x', '/ses', result)).toBeNull();
    });

    it('does not trigger commands overlay for / query in middle of existing text', () => {
        const controller = new AutocompleteController();
        const text = 'abc /sess';
        const cursor = text.length;
        const result = controller.update(text, cursor);

        expect(result).toEqual({ trigger: '/', query: 'sess' });
        expect(resolveAutocompleteOverlayIntent('/', 'abc ', result)).toBeNull();
    });
});
