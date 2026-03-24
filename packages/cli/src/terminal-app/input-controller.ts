import { parseInputChunkWithRest, type TerminalInputEvent } from '../terminal-core/input-parser.js';
import type { TerminalAppState } from '../terminal-core/app-state.js';

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

interface InputControllerOptions {
    onCtrlC: () => void;
    readClipboard: () => string | undefined;
    onPaste: (text: string) => void;
    onEscape: () => boolean;
}

export class InputController {
    private inputBuffer = '';
    private bracketedPasteBuffer: string | null = null;
    private readonly options: InputControllerOptions;

    constructor(options: InputControllerOptions) {
        this.options = options;
    }

    consumeDecodedChunk(text: string): { handled: boolean; events: TerminalInputEvent[] } {
        if (text === '\u0003') {
            this.options.onCtrlC();
            return { handled: true, events: [] };
        }

        if (text === '\x16' || text === '\x1bv') {
            const content = this.options.readClipboard();
            if (content) {
                this.options.onPaste(content.replace(/\r\n?/g, '\n'));
            }
            return { handled: true, events: [] };
        }

        if (text === '\x1b' && this.options.onEscape()) {
            return { handled: true, events: [] };
        }

        if (this.bracketedPasteBuffer !== null) {
            this.bracketedPasteBuffer += text;
            const endIdx = this.bracketedPasteBuffer.indexOf(BRACKETED_PASTE_END);
            if (endIdx === -1) {
                return { handled: true, events: [] };
            }
            const content = this.bracketedPasteBuffer.slice(0, endIdx).replace(/\r\n?/g, '\n');
            text = this.bracketedPasteBuffer.slice(endIdx + BRACKETED_PASTE_END.length);
            this.bracketedPasteBuffer = null;
            this.options.onPaste(content);
            if (text.length === 0) {
                return { handled: true, events: [] };
            }
        }

        if (this.bracketedPasteBuffer === null && text.startsWith(BRACKETED_PASTE_START)) {
            const endIdx = text.indexOf(BRACKETED_PASTE_END, BRACKETED_PASTE_START.length);
            if (endIdx === -1) {
                this.bracketedPasteBuffer = text.slice(BRACKETED_PASTE_START.length);
                return { handled: true, events: [] };
            }
            const content = text.slice(BRACKETED_PASTE_START.length, endIdx).replace(/\r\n?/g, '\n');
            this.options.onPaste(content);
            text = text.slice(endIdx + BRACKETED_PASTE_END.length);
            if (text.length === 0) {
                return { handled: true, events: [] };
            }
        }

        const hasNewline = text.includes('\n') || text.includes('\r');
        const hasNonNewline = text.replace(/\r\n?|\n/g, '').length > 0;
        if (hasNewline && hasNonNewline && !text.startsWith(BRACKETED_PASTE_START)) {
            this.options.onPaste(text.replace(/\r\n?/g, '\n'));
            return { handled: true, events: [] };
        }

        this.inputBuffer += text;
        const { events, rest } = parseInputChunkWithRest(this.inputBuffer);
        this.inputBuffer = rest;
        return { handled: false, events };
    }
}

export type InputShortcutIntent =
    | { type: 'interrupt' }
    | { type: 'overlay.move'; delta: 1 | -1 }
    | { type: 'overlay.escape' }
    | { type: 'open.filepicker' }
    | { type: 'open.commands' }
    | { type: 'open.theme' }
    | { type: 'open.help' }
    | { type: 'open.session' }
    | { type: 'open.model' }
    | { type: 'new.session' };

export function resolveShortcutIntent(
    input: TerminalInputEvent,
    state: Pick<TerminalAppState, 'overlay'>,
): InputShortcutIntent | null {
    if (input.type === 'key' && input.ctrl && input.key === 'c') {
        return { type: 'interrupt' };
    }

    if (state.overlay) {
        if (input.type === 'text' && (input.text === 'j' || input.text === 'k') && state.overlay.type !== 'arguments') {
            return { type: 'overlay.move', delta: input.text === 'j' ? 1 : -1 };
        }
        if (input.type === 'key' && input.key === 'up') {
            return { type: 'overlay.move', delta: -1 };
        }
        if (input.type === 'key' && input.key === 'down') {
            return { type: 'overlay.move', delta: 1 };
        }
        if (input.type === 'key' && input.key === 'escape') {
            return { type: 'overlay.escape' };
        }
        return null;
    }

    if (!(input.type === 'key' && input.ctrl && !input.alt)) {
        return null;
    }

    if (input.key === 'f') return { type: 'open.filepicker' };
    if (input.key === 'k' || input.key === 'p') return { type: 'open.commands' };
    if (input.key === 't') return { type: 'open.theme' };
    if (input.key === 's') return { type: 'open.session' };
    if (input.key === 'n') return { type: 'new.session' };
    if (input.key === 'o') return { type: 'open.model' };
    if (input.key === '?' || input.key === 'h') return { type: 'open.help' };

    return null;
}
