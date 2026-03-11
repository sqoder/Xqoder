import type { AppEvent } from '@xqoder/protocol';
import type { ScreenBuffer, ScreenPatch, TerminalSize } from './screen-buffer.js';
import type { TerminalInputEvent } from './input-parser.js';

export type TerminalCoreEvent =
    | { type: 'input'; input: TerminalInputEvent }
    | { type: 'runtime'; event: AppEvent }
    | { type: 'shell'; stream: 'stdout' | 'stderr'; chunk: string; commandId?: string }
    | { type: 'timer'; timerId: string; now: number }
    | { type: 'resize'; size: TerminalSize }
    | { type: 'editor.reset' }
    | { type: 'editor.set-value'; value: string; cursorOffset?: number }
    | { type: 'editor.append-attachment'; attachment: { id: string; label: string; kind: 'file' | 'image' | 'text'; path?: string } }
    | { type: 'editor.remove-last-attachment' }
    | { type: 'editor.clear-attachments' }
    | { type: 'notice.set'; notice?: string }
    | { type: 'session.attached'; sessionId: string }
    | { type: 'copy.code-block'; blockId: string }
    | { type: 'copy.code-block.clear' };

export interface TerminalRenderResult {
    buffer: ScreenBuffer;
    patches: ScreenPatch[];
    cursor?: {
        x: number;
        y: number;
        visible?: boolean;
    };
    /** When true, writer should clear screen and home before patches (avoids content drift when terminal scrolls). */
    fullRedraw?: boolean;
}

export interface TerminalWriter {
    write(result: TerminalRenderResult): void | Promise<void>;
}

export interface TerminalEventSource {
    start(dispatch: (event: TerminalCoreEvent) => void): () => void | Promise<void>;
}

export interface TerminalSubscription<State> {
    getState(): State;
    unsubscribe(): void;
}
