import type { AppEvent } from '@xqoder/protocol';
import type { TerminalInputEvent } from './input-parser.js';

export interface TerminalSize {
    width: number;
    height: number;
}

export interface CellStyle {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    inverse?: boolean;
    underline?: boolean;
}

export interface LayoutMetrics {
    mainWidth: number;
    sidebarWidth: number;
    transcriptHeight: number;
    transcriptContentWidth: number;
    editorContentWidth: number;
    scrollbarCol: number;
    editorY: number;
    editorHeight: number;
    statusY: number;
    statusHeight: number;
    sidebarX: number;
    outerScrollbarCol: number;
}

export interface TerminalTheme {
    id: string;
    background: string;
    foreground: string;
    border: string;
    accent: string;
    muted: string;
}

export const DEFAULT_TERMINAL_THEME: TerminalTheme = {
    id: 'default',
    background: '#0D0D0F',
    foreground: '#FFFFFF',
    border: '#2C2E33',
    accent: '#4FD1C5',
    muted: '#718096',
};

export const TERMINAL_THEME_IDS = ['default', 'dark', 'light'] as const;
export const TERMINAL_THEME_LABELS: Record<string, string> = {
    default: 'Xqoder Default',
    dark: 'Deep Dark',
    light: 'Quiet Light',
};

export function getTheme(id: string): TerminalTheme {
    return DEFAULT_TERMINAL_THEME;
}

export type TerminalCoreEvent =
    | { type: 'input'; input: TerminalInputEvent }
    | { type: 'viewport.sync' }
    | { type: 'logViewport.sync' }
    | { type: 'viewport.scroll'; delta: number }
    | { type: 'viewport.page'; direction: 'up' | 'down' }
    | { type: 'viewport.home' }
    | { type: 'viewport.end' }
    | { type: 'page.toggle' }
    | { type: 'logViewport.scroll'; delta: number }
    | { type: 'logViewport.page'; direction: 'up' | 'down' }
    | { type: 'logViewport.home' }
    | { type: 'logViewport.end' }
    | { type: 'viewport.intent.setTopLine'; topLine: number }
    | { type: 'viewport.intent.scrollbar'; pointerRow: number; dragOffset?: number }
    | { type: 'viewport.intent.jump'; targetLine: number; anchorNumerator?: number; anchorDenominator?: number }
    | { type: 'viewport.selection.set'; selection: { start: { line: number; column: number }; end: { line: number; column: number } } | null }
    | { type: 'viewport.focusLine.set'; line: number | null }
    | { type: 'runtime'; event: AppEvent }
    | { type: 'ui.tool.feedback.called'; sessionId: string; timestamp: number; tool: string; args: import('@xqoder/protocol').JsonValue }
    | { type: 'ui.tool.feedback.output'; sessionId: string; timestamp: number; tool: string; output: string; partial?: boolean }
    | { type: 'ui.tool.feedback.completed'; sessionId: string; timestamp: number; tool: string; success: boolean; metadata?: import('@xqoder/protocol').JsonRecord }
    | { type: 'shell'; stream: 'stdout' | 'stderr'; chunk: string; commandId?: string }
    | { type: 'timer'; timerId: string; now: number }
    | { type: 'interaction.mode.toggle' }
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
    | { type: 'overlay.open'; kind: 'commands'; items: Array<{ id: string; label: string; description?: string; pro?: boolean }> }
    | { type: 'overlay.commandsFilter'; query: string }
    | { type: 'overlay.open'; kind: 'help'; items: Array<{ key: string; description: string; section?: 'Session' | 'Editor' | 'Navigation' | 'Global'; weight?: number }> }
    | { type: 'overlay.open'; kind: 'filepicker'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.open'; kind: 'complete'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.open'; kind: 'theme'; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.open'; kind: 'init'; items: Array<{ id: string; label: string }> }
    | { type: 'overlay.filepickerEnterDir'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.filepickerGoParent'; currentDir: string; items: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.filepickerInputMode'; enabled: boolean }
    | { type: 'overlay.filepickerPathEdit'; append?: string; backspace?: boolean }
    | { type: 'overlay.completeExpand'; path: string; children: Array<{ path: string; label: string; isDir: boolean }> }
    | { type: 'overlay.completeCollapse'; path: string }
    | { type: 'overlay.completeScrollAt'; delta: 1 | -1; anchorRow: number }
    | { type: 'overlay.completeSetSelected'; index: number }
    | { type: 'overlay.move'; delta: 1 | -1 }
    | { type: 'overlay.close' }
    | { type: 'overlay.closeWithSelect'; kind: 'session'; id: string; title?: string }
    | { type: 'overlay.closeWithSelect'; kind: 'model'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'commands'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'filepicker'; path: string }
    | { type: 'overlay.closeWithSelect'; kind: 'complete'; path: string }
    | { type: 'overlay.closeWithSelect'; kind: 'theme'; id: string }
    | { type: 'overlay.closeWithSelect'; kind: 'init' }
    | { type: 'overlay.open'; kind: 'arguments'; commandName: string; variables: string[]; initialValues?: Record<string, string> }
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
    | { type: 'question.custom.backspace' }
    | { type: 'diff.context.toggle'; blockId: string }
    | { type: 'context.group.toggle'; entryId: string };

export interface TerminalEventSource {
    start(dispatch: (event: TerminalCoreEvent) => void): () => void | Promise<void>;
}

export interface TerminalSubscription<State> {
    getState(): State;
    unsubscribe(): void;
}
