import { describe, expect, it, vi } from 'vitest';
import { InputController, resolveShortcutIntent } from './input-controller.js';

describe('InputController', () => {
    it('collects bracketed paste across chunks and normalizes line breaks', () => {
        const onPaste = vi.fn();
        const controller = new InputController({
            onCtrlC: vi.fn(),
            readClipboard: () => undefined,
            onPaste,
            onEscape: () => false,
        });

        const first = controller.consumeDecodedChunk('\x1b[200~line1\r');
        expect(first.handled).toBe(true);
        expect(first.events).toEqual([]);
        expect(onPaste).not.toHaveBeenCalled();

        const second = controller.consumeDecodedChunk('\nline2\x1b[201~');
        expect(second.handled).toBe(true);
        expect(second.events).toEqual([]);
        expect(onPaste).toHaveBeenCalledTimes(1);
        expect(onPaste).toHaveBeenCalledWith('line1\nline2');
    });

    it('treats mixed newline/plain input as paste payload', () => {
        const onPaste = vi.fn();
        const controller = new InputController({
            onCtrlC: vi.fn(),
            readClipboard: () => undefined,
            onPaste,
            onEscape: () => false,
        });

        const result = controller.consumeDecodedChunk('a\nb\nc');
        expect(result.handled).toBe(true);
        expect(result.events).toEqual([]);
        expect(onPaste).toHaveBeenCalledWith('a\nb\nc');
    });
});

describe('resolveShortcutIntent', () => {
    it('keeps overlay focus stable by only handling overlay navigation keys', () => {
        const withOverlay = { overlay: { type: 'commands' } } as any;
        expect(resolveShortcutIntent({ type: 'key', key: 'k', ctrl: true, raw: '' }, withOverlay)).toBeNull();
        expect(resolveShortcutIntent({ type: 'text', text: 'j', raw: 'j' }, withOverlay)).toEqual({
            type: 'overlay.move',
            delta: 1,
        });
    });

    it('resolves global shortcuts when overlay is closed', () => {
        const noOverlay = { overlay: null } as any;
        expect(resolveShortcutIntent({ type: 'key', key: 'n', ctrl: true, raw: '' }, noOverlay)).toEqual({
            type: 'new.session',
        });
    });
});

