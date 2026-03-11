import type { TerminalAppState } from '../terminal-core/app-state.js';
import { reduceEditorModel } from '../terminal-core/editor-model.js';
import { getTranscriptHeight, reduceTerminalRuntimeResize, reduceProtocolEventToTerminalState } from '../terminal-core/runtime-bridge.js';
import { moveViewportModelToBottom, moveViewportModelToTop, pageViewportModel, scrollViewportModel, syncViewportModel } from '../terminal-core/viewport-model.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';

const VIEWPORT_SCROLL_STEP = 3;

export function reduceTerminalAppState(state: TerminalAppState, event: TerminalCoreEvent): TerminalAppState {
    switch (event.type) {
        case 'resize': {
            const th = getTranscriptHeight({ ...state, size: event.size });
            return reduceTerminalRuntimeResize({
                ...state,
                viewport: syncViewportModel(state.viewport, {
                    lineCount: state.transcriptLines.length,
                    previousLineCount: state.transcriptLines.length,
                    height: th,
                }),
            }, event.size);
        }
        case 'runtime': {
            const next = reduceProtocolEventToTerminalState(state, event.event);
            const th = getTranscriptHeight(next);
            return {
                ...next,
                viewport: syncViewportModel(next.viewport, {
                    lineCount: next.transcriptLines.length,
                    previousLineCount: state.transcriptLines.length,
                    height: th,
                }),
            };
        }
        case 'shell':
            return reduceProtocolEventToTerminalState({
                ...state,
                transcriptEntries: [...state.transcriptEntries, {
                    id: `shell:${event.commandId ?? 'default'}:${Date.now()}`,
                    role: 'system',
                    content: event.chunk,
                }],
            }, {
                type: 'status.changed',
                sessionId: state.activeSessionId ?? 'shell-session',
                timestamp: Date.now(),
                source: 'runtime',
                status: 'done',
            });
        case 'input': {
            const input = event.input;
            if (input.type === 'text') {
                return { ...state, editor: reduceEditorModel(state.editor, { type: 'insert-text', text: input.text }) };
            }
            if (input.type === 'paste') {
                return { ...state, editor: reduceEditorModel(state.editor, { type: 'paste', text: input.text }) };
            }
            if (input.type === 'mouse') {
                const th = getTranscriptHeight(state);
                if (input.button === 'wheelUp') {
                    return { ...state, viewport: scrollViewportModel(state.viewport, -VIEWPORT_SCROLL_STEP, state.transcriptLines.length, th) };
                }
                if (input.button === 'wheelDown') {
                    return { ...state, viewport: scrollViewportModel(state.viewport, VIEWPORT_SCROLL_STEP, state.transcriptLines.length, th) };
                }
                return state;
            }

            const transcriptHeight = getTranscriptHeight(state);
            switch (input.key) {
                case 'backspace':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-backward' }) };
                case 'delete':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-forward' }) };
                case 'left':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-horizontal', delta: -1 }) };
                case 'right':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-horizontal', delta: 1 }) };
                case 'up':
                    if (input.shift) {
                        return { ...state, viewport: scrollViewportModel(state.viewport, -VIEWPORT_SCROLL_STEP, state.transcriptLines.length, transcriptHeight) };
                    }
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-vertical', delta: -1 }) };
                case 'down':
                    if (input.shift) {
                        return { ...state, viewport: scrollViewportModel(state.viewport, VIEWPORT_SCROLL_STEP, state.transcriptLines.length, transcriptHeight) };
                    }
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-vertical', delta: 1 }) };
                case 'home':
                    return { ...state, viewport: moveViewportModelToTop(state.viewport) };
                case 'end':
                    return { ...state, viewport: moveViewportModelToBottom(state.viewport, state.transcriptLines.length, transcriptHeight) };
                case 'pageup':
                    return { ...state, viewport: pageViewportModel(state.viewport, 'up', state.transcriptLines.length, transcriptHeight) };
                case 'pagedown':
                    return { ...state, viewport: pageViewportModel(state.viewport, 'down', state.transcriptLines.length, transcriptHeight) };
                case 'tab':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'insert-text', text: '    ' }) };
                default:
                    return state;
            }
        }
        case 'editor.reset':
            return {
                ...state,
                editor: reduceEditorModel(state.editor, { type: 'set-value', value: '', cursorOffset: 0 }),
            };
        case 'editor.set-value':
            return {
                ...state,
                editor: reduceEditorModel(state.editor, { type: 'set-value', value: event.value, cursorOffset: event.cursorOffset }),
            };
        case 'editor.append-attachment':
            return {
                ...state,
                editor: reduceEditorModel(state.editor, { type: 'append-attachment', attachment: event.attachment }),
            };
        case 'editor.remove-last-attachment': {
            const last = state.editor.attachments.at(-1);
            if (!last) {
                return state;
            }
            return {
                ...state,
                editor: reduceEditorModel(state.editor, { type: 'remove-attachment', id: last.id }),
            };
        }
        case 'editor.clear-attachments':
            return {
                ...state,
                editor: reduceEditorModel(state.editor, { type: 'clear-attachments' }),
            };
        case 'notice.set':
            return {
                ...state,
                notice: event.notice,
            };
        case 'session.attached':
            return {
                ...state,
                activeSessionId: event.sessionId,
            };
        case 'copy.code-block':
            return {
                ...state,
                copiedBlockId: event.blockId,
            };
        case 'copy.code-block.clear':
            return {
                ...state,
                copiedBlockId: null,
            };
        case 'timer':
            return state;
        default:
            return state;
    }
}
