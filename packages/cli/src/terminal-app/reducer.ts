import type { TerminalAppState } from '../terminal-core/app-state.js';
import { reduceEditorModel } from '../terminal-core/editor-model.js';
import { getTranscriptHeight, reduceTerminalRuntimeResize, reduceProtocolEventToTerminalState, restoreTerminalHistory } from '../terminal-core/runtime-bridge.js';
import { moveViewportModelToBottom, moveViewportModelToTop, pageViewportModel, scrollViewportModel, setViewportTopLine, syncViewportModel } from '../terminal-core/viewport-model.js';
import { withDerivedChrome } from '../terminal-core/runtime-bridge.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';

const VIEWPORT_SCROLL_STEP = 3;

export function reduceTerminalAppState(state: TerminalAppState, event: TerminalCoreEvent): TerminalAppState {
    switch (event.type) {
        case 'approval.menu.move':
            return withDerivedChrome({
                ...state,
                pendingApproval: state.pendingApproval
                    ? { ...state.pendingApproval, selectedIndex: event.selectedIndex }
                    : state.pendingApproval,
            });
        case 'question.menu.move':
            return withDerivedChrome({
                ...state,
                pendingQuestion: state.pendingQuestion
                    ? { ...state.pendingQuestion, selectedIndex: event.selectedIndex }
                    : state.pendingQuestion,
            });
        case 'question.toggle-option': {
            if (!state.pendingQuestion) {
                return state;
            }
            const selectedSet = new Set(state.pendingQuestion.selected);
            if (selectedSet.has(event.optionLabel)) {
                selectedSet.delete(event.optionLabel);
            } else if (state.pendingQuestion.multiple) {
                selectedSet.add(event.optionLabel);
            } else {
                selectedSet.clear();
                selectedSet.add(event.optionLabel);
            }
            return withDerivedChrome({
                ...state,
                pendingQuestion: {
                    ...state.pendingQuestion,
                    selected: Array.from(selectedSet),
                },
            });
        }
        case 'question.custom.append':
            return withDerivedChrome({
                ...state,
                pendingQuestion: state.pendingQuestion
                    ? { ...state.pendingQuestion, customText: state.pendingQuestion.customText + event.text }
                    : state.pendingQuestion,
            });
        case 'question.custom.backspace':
            return withDerivedChrome({
                ...state,
                pendingQuestion: state.pendingQuestion
                    ? { ...state.pendingQuestion, customText: state.pendingQuestion.customText.slice(0, -1) }
                    : state.pendingQuestion,
            });
        case 'resize': {
            const th = getTranscriptHeight({ ...state, size: event.size });
            const next = reduceTerminalRuntimeResize({
                ...state,
                viewport: syncViewportModel(state.viewport, {
                    lineCount: state.transcriptLines.length,
                    previousLineCount: state.transcriptLines.length,
                    height: th,
                }),
                logViewport: syncViewportModel(state.logViewport, {
                    lineCount: state.logLines.length,
                    previousLineCount: state.logLines.length,
                    height: th,
                }),
            }, event.size);
            const editorContentWidth = Math.max(10, event.size.width - 6);
            return { ...next, editor: reduceEditorModel(next.editor, { type: 'set-content-width', width: editorContentWidth }) };
        }
        case 'runtime': {
            let next = reduceProtocolEventToTerminalState(state, event.event);
            if (event.event.type === 'tool.called') {
                const ev = event.event;
                const args = ev.args as Record<string, unknown> | undefined;
                const pathVal = args?.path ?? args?.file_path ?? args?.filePath;
                const pathStr = typeof pathVal === 'string' ? pathVal : undefined;
                const fileTools = ['write_file', 'search_replace', 'patch_file', 'edit_file'];
                if (pathStr && fileTools.includes(ev.tool)) {
                    next = { ...next, modifiedFiles: next.modifiedFiles.includes(pathStr) ? next.modifiedFiles : [...next.modifiedFiles, pathStr] };
                }
            }
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
        case 'shell': {
            const newLogLines = event.chunk.split(/\n/);
            const logLines = [...state.logLines, ...newLogLines];
            const th = getTranscriptHeight(state);
            const nextLogViewport = syncViewportModel(state.logViewport, {
                lineCount: logLines.length,
                previousLineCount: state.logLines.length,
                height: th,
            });
            return reduceProtocolEventToTerminalState({
                ...state,
                transcriptEntries: [...state.transcriptEntries, {
                    id: `shell:${event.commandId ?? 'default'}:${Date.now()}`,
                    role: 'system',
                    content: event.chunk,
                }],
                logLines,
                logViewport: nextLogViewport,
            }, {
                type: 'status.changed',
                sessionId: state.activeSessionId ?? 'shell-session',
                timestamp: Date.now(),
                source: 'runtime',
                status: 'done',
            });
        }
        case 'viewport.scroll': {
            const th = getTranscriptHeight(state);
            return { ...state, viewport: scrollViewportModel(state.viewport, event.delta, state.transcriptLines.length, th) };
        }
        case 'viewport.page': {
            const th = getTranscriptHeight(state);
            return { ...state, viewport: pageViewportModel(state.viewport, event.direction, state.transcriptLines.length, th) };
        }
        case 'viewport.home':
            return { ...state, viewport: moveViewportModelToTop(state.viewport) };
        case 'viewport.end': {
            const th = getTranscriptHeight(state);
            return { ...state, viewport: moveViewportModelToBottom(state.viewport, state.transcriptLines.length, th) };
        }
        case 'viewport.topLine.set': {
            const th = getTranscriptHeight(state);
            return { ...state, viewport: setViewportTopLine(state.viewport, event.topLine, state.transcriptLines.length, th) };
        }
        case 'viewport.selection.set':
            return {
                ...state,
                viewport: { ...state.viewport, selection: event.selection },
            };
        case 'viewport.focusLine.set':
            return {
                ...state,
                viewport: { ...state.viewport, focusLine: event.line },
            };
        case 'input': {
            const input = event.input;
            if (input.type === 'text') {
                return { ...state, editor: reduceEditorModel(state.editor, { type: 'insert-text', text: input.text }) };
            }
            if (input.type === 'paste') {
                const trimmed = input.text.trim();
                const action = trimmed.includes('\n')
                    ? ({ type: 'paste-as-placeholder' as const, text: trimmed })
                    : ({ type: 'paste' as const, text: trimmed });
                return { ...state, editor: reduceEditorModel(state.editor, action) };
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
                case 'delete-to-line-start':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-to-line-start' }) };
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
        case 'session.restored': {
            const next = restoreTerminalHistory(state, {
                sessionId: event.sessionId,
                title: event.title,
                cwd: event.cwd,
                messages: event.messages,
            });
            const th = getTranscriptHeight(next);
            return {
                ...next,
                modifiedFiles: [],
                viewport: syncViewportModel(next.viewport, {
                    lineCount: next.transcriptLines.length,
                    previousLineCount: state.transcriptLines.length,
                    height: th,
                }),
            };
        }
        case 'session.new': {
            const next = withDerivedChrome({
                ...state,
                activeSessionId: undefined,
                transcriptEntries: [],
                title: 'New Session',
                notice: 'New session (send a message to start)',
                modifiedFiles: [],
            });
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
        case 'paste.hint.show':
            return { ...state, pasteHint: { lineCount: event.lineCount } };
        case 'paste.hint.clear':
            return { ...state, pasteHint: null };
        case 'toast.push':
            return {
                ...state,
                toasts: [
                    ...state.toasts,
                    {
                        id: event.id,
                        text: event.text,
                        kind: event.kind,
                        ttl: event.ttl,
                        createdAt: Date.now(),
                    },
                ],
            };
        case 'toast.dismiss':
            return {
                ...state,
                toasts: state.toasts.filter((t) => t.id !== event.id),
            };
        case 'overlay.open':
            if (event.kind === 'session') {
                return { ...state, overlay: { type: 'session', items: event.items, selectedIndex: 0 } };
            }
            if (event.kind === 'commands') {
                return { ...state, overlay: { type: 'commands', items: event.items, selectedIndex: 0 } };
            }
            if (event.kind === 'filepicker') {
                return { ...state, overlay: { type: 'filepicker', currentDir: event.currentDir, items: event.items, selectedIndex: 0 } };
            }
            if (event.kind === 'complete') {
                return {
                    ...state,
                    overlay: {
                        type: 'complete',
                        currentDir: event.currentDir,
                        items: event.items.map((i) => ({ ...i, depth: 0 })),
                        expandedDirs: [],
                        selectedIndex: 0,
                    },
                };
            }
            if (event.kind === 'theme') {
                return { ...state, overlay: { type: 'theme', items: event.items, selectedIndex: 0 } };
            }
            if (event.kind === 'init') {
                return { ...state, overlay: { type: 'init', items: event.items, selectedIndex: 0 } };
            }
            if (event.kind === 'arguments') {
                return {
                    ...state,
                    overlay: {
                        type: 'arguments',
                        commandName: event.commandName,
                        variables: event.variables,
                        values: {},
                        selectedIndex: 0,
                        editBuffer: '',
                    },
                };
            }
            if (event.kind === 'model') {
                return {
                    ...state,
                    overlay: {
                        type: 'model',
                        providers: event.providers,
                        providerIndex: event.providerIndex,
                        items: event.items,
                        selectedIndex: 0,
                    },
                };
            }
            return state;
        case 'overlay.modelSetProvider': {
            const ov = state.overlay;
            if (!ov || ov.type !== 'model') return state;
            return {
                ...state,
                overlay: {
                    ...ov,
                    providerIndex: event.providerIndex,
                    items: event.items,
                    selectedIndex: 0,
                },
            };
        }
        case 'overlay.filepickerNavigate':
            if (!state.overlay || state.overlay.type !== 'filepicker') return state;
            return {
                ...state,
                overlay: { ...state.overlay, currentDir: event.currentDir, items: event.items, selectedIndex: 0 },
            };
        case 'overlay.completeExpand': {
            const ov = state.overlay;
            if (!ov || ov.type !== 'complete') return state;
            const idx = ov.items.findIndex((it) => it.path === event.path);
            if (idx < 0) return state;
            const depth = ov.items[idx]!.depth + 1;
            const children = event.children.map((c) => ({ ...c, depth }));
            const nextItems = [...ov.items.slice(0, idx + 1), ...children, ...ov.items.slice(idx + 1)];
            const nextExpanded = ov.expandedDirs.includes(event.path) ? ov.expandedDirs : [...ov.expandedDirs, event.path];
            return { ...state, overlay: { ...ov, items: nextItems, expandedDirs: nextExpanded } };
        }
        case 'overlay.completeCollapse': {
            const ov = state.overlay;
            if (!ov || ov.type !== 'complete') return state;
            const path = event.path;
            const pathPrefix = path + (path.endsWith('/') ? '' : '/');
            const isUnder = (p: string) => p !== path && (p.startsWith(pathPrefix) || p.startsWith(path + '\\'));
            const nextItems = ov.items.filter((it) => !isUnder(it.path));
            const nextExpanded = ov.expandedDirs.filter((p) => p !== path && !isUnder(p));
            return { ...state, overlay: { ...ov, items: nextItems, expandedDirs: nextExpanded } };
        }
        case 'overlay.move': {
            const ov = state.overlay;
            if (!ov) return state;
            const len = ov.type === 'arguments' ? ov.variables.length : ov.items.length;
            const next = Math.max(0, Math.min(len - 1, ov.selectedIndex + event.delta));
            const nextEditBuffer = ov.type === 'arguments' ? (ov.values[ov.variables[next]!] ?? '') : undefined;
            return {
                ...state,
                overlay: { ...ov, selectedIndex: next, ...(nextEditBuffer !== undefined ? { editBuffer: nextEditBuffer } : {}) },
            };
        }
        case 'overlay.argumentsEdit': {
            if (state.overlay?.type !== 'arguments') return state;
            const ov = state.overlay;
            const editBuffer = event.backspace
                ? ov.editBuffer.slice(0, -1)
                : ov.editBuffer + (event.append ?? '');
            return { ...state, overlay: { ...ov, editBuffer } };
        }
        case 'overlay.argumentsAdvance': {
            if (state.overlay?.type !== 'arguments') return state;
            const ov = state.overlay;
            const nextIndex = ov.selectedIndex + 1;
            const editBuffer = nextIndex < ov.variables.length ? (event.values[ov.variables[nextIndex]!] ?? '') : '';
            return { ...state, overlay: { ...ov, values: event.values, selectedIndex: nextIndex, editBuffer } };
        }
        case 'overlay.close':
            return { ...state, overlay: null };
        case 'overlay.closeWithSelect':
            return {
                ...state,
                overlay: null,
                ...(event.kind === 'theme' ? { themeId: event.id } : {}),
            };
        case 'model.set':
            return { ...state, model: event.model };
        case 'page.toggle':
            return { ...state, page: state.page === 'chat' ? 'logs' : 'chat' };
        case 'logViewport.scroll': {
            const th = getTranscriptHeight(state);
            return { ...state, logViewport: scrollViewportModel(state.logViewport, event.delta, state.logLines.length, th) };
        }
        case 'logViewport.page': {
            const th = getTranscriptHeight(state);
            return { ...state, logViewport: pageViewportModel(state.logViewport, event.direction, state.logLines.length, th) };
        }
        case 'logViewport.home':
            return { ...state, logViewport: moveViewportModelToTop(state.logViewport) };
        case 'logViewport.end': {
            const th = getTranscriptHeight(state);
            return { ...state, logViewport: moveViewportModelToBottom(state.logViewport, state.logLines.length, th) };
        }
        case 'modifiedFiles.add': {
            const paths = state.modifiedFiles.includes(event.path) ? state.modifiedFiles : [...state.modifiedFiles, event.path];
            return { ...state, modifiedFiles: paths };
        }
        case 'modifiedFiles.clear':
            return { ...state, modifiedFiles: [] };
        case 'timer':
            return state;
        default:
            return state;
    }
}
