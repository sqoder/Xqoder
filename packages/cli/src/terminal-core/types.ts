import type { AppEvent } from '@xqoder/protocol';
import type { ScreenBuffer, ScreenPatch, TerminalSize } from './screen-buffer.js';
import type { TerminalInputEvent } from './input-parser.js';

export type TerminalCoreEvent =
    | { type: 'input'; input: TerminalInputEvent }
    | { type: 'viewport.scroll'; delta: number }
    | { type: 'viewport.page'; direction: 'up' | 'down' }
    | { type: 'viewport.home' }
    | { type: 'viewport.end' }
    | { type: 'page.toggle' }
    | { type: 'logViewport.scroll'; delta: number }
    | { type: 'logViewport.page'; direction: 'up' | 'down' }
    | { type: 'logViewport.home' }
    | { type: 'logViewport.end' }
    | { type: 'viewport.topLine.set'; topLine: number }
    | { type: 'viewport.selection.set'; selection: { start: { line: number; column: number }; end: { line: number; column: number } } | null }
    | { type: 'viewport.focusLine.set'; line: number | null }
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
    | { type: 'session.restored'; sessionId: string; title?: string; cwd?: string; messages: import('@xqoder/shared').LLMMessage[] }
    | { type: 'session.new' }
    | { type: 'copy.code-block'; blockId: string }
    | { type: 'copy.code-block.clear' }
    | { type: 'paste.hint.show'; lineCount: number }
    | { type: 'paste.hint.clear' }
    | { type: 'toast.push'; id: string; text: string; kind: 'info' | 'success' | 'error'; ttl: number }
    | { type: 'toast.dismiss'; id: string }
    | { type: 'overlay.open'; kind: 'session'; items: Array<{ id: string; title: string }> }
    | { type: 'overlay.open'; kind: 'model'; providers: string[]; providerIndex: number; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.modelSetProvider'; providerIndex: number; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.open'; kind: 'commands'; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.open'; kind: 'filepicker'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.open'; kind: 'complete'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.open'; kind: 'theme'; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.open'; kind: 'init'; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.filepickerNavigate'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.completeExpand'; path: string; children: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.completeCollapse'; path: string }
    | { type: 'overlay.move'; delta: 1 | -1 }
    | { type: 'overlay.close' }
    | { type: 'overlay.closeWithSelect'; kind: 'session'; id: string; title?: string }
    | { type: 'overlay.closeWithSelect'; kind: 'model'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'commands'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'filepicker'; path: string }
    | { type: 'overlay.closeWithSelect'; kind: 'complete'; path: string }
    | { type: 'overlay.closeWithSelect'; kind: 'theme'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'init' }
    | { type: 'overlay.open'; kind: 'arguments'; commandName: string; variables: string[] }
    | { type: 'overlay.argumentsEdit'; append?: string; backspace?: boolean }
    | { type: 'overlay.argumentsAdvance'; values: Record<string, string> }
    | { type: 'overlay.closeWithSelect'; kind: 'arguments'; commandName: string; values: Record<string, string> }
    | { type: 'modifiedFiles.add'; path: string }
    | { type: 'modifiedFiles.clear' }
    | { type: 'model.set'; model: string }
    | { type: 'approval.menu.move'; selectedIndex: 0 | 1 | 2 }
    | { type: 'question.menu.move'; selectedIndex: number }
    | { type: 'question.toggle-option'; optionLabel: string }
    | { type: 'question.custom.append'; text: string }
    | { type: 'question.custom.backspace' };

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
