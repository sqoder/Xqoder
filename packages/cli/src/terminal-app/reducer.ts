import type { AppEvent } from '@xqoder/protocol';
import type { TerminalAppState } from '../terminal-core/app-state.js';
import { reduceEditorModel } from '../terminal-core/editor-model.js';
import { reduceTerminalRuntimeResize, reduceProtocolEventToTerminalState, reduceUiToolFeedbackToTerminalState, restoreTerminalHistory } from '../terminal-core/runtime-bridge.js';
import { withDerivedChrome } from '../terminal-core/runtime-bridge.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import {
    applyChatViewportIntent,
    applyLogViewportScrollbar,
    getChatViewportHeight,
    getCompleteOverlayVisibleRowsForState,
    moveChatViewportToBottom,
    moveChatViewportToTop,
    moveLogViewportEnd,
    moveLogViewportHome,
    pageChatViewport,
    pageLogViewport,
    scrollChatViewport,
    scrollLogViewport,
    setChatViewportTopLine,
    setLogViewportTopLineIntent,
    syncLogViewport,
    syncTranscriptViewport,
    withChatViewportProjection,
    withLogViewportProjection,
} from './reducer-viewport.js';
import {
    advanceArgumentsOverlay,
    closeOverlay,
    closeOverlayWithSelect,
    collapseCompleteOverlay,
    editArgumentsOverlay,
    editFilepickerPath,
    enterFilepickerDir,
    expandCompleteOverlay,
    filterCommandsOverlay,
    goFilepickerParent,
    moveOverlaySelection,
    openOverlay,
    scrollCompleteOverlayAt,
    setCompleteOverlaySelected,
    setFilepickerInputMode,
    setOverlayModelProvider,
} from './reducer-overlay.js';

const VIEWPORT_SCROLL_STEP = 3;

function applyRuntimeEvent(state: TerminalAppState, runtimeEvent: AppEvent): TerminalAppState {
    let next = reduceProtocolEventToTerminalState(state, runtimeEvent);
    if (runtimeEvent.type === 'tool.called') {
        const args = runtimeEvent.args as Record<string, unknown> | undefined;
        const pathVal = args?.path ?? args?.file_path ?? args?.filePath;
        const pathStr = typeof pathVal === 'string' ? pathVal : undefined;
        const fileTools = ['write_file', 'search_replace', 'patch_file', 'edit_file'];
        if (pathStr && fileTools.includes(runtimeEvent.tool)) {
            next = { ...next, modifiedFiles: next.modifiedFiles.includes(pathStr) ? next.modifiedFiles : [...next.modifiedFiles, pathStr] };
        }
    }
    return syncTranscriptViewport(next);
}

export function reduceTerminalAppState(state: TerminalAppState, event: TerminalCoreEvent): TerminalAppState {
    switch (event.type) {
        case 'viewport.sync':
            return withChatViewportProjection(state);
        case 'logViewport.sync':
            return withLogViewportProjection(state);
        case 'approval.menu.move':
            return withDerivedChrome({
                ...state,
                approvalInput: state.pendingApproval
                    ? { selectedIndex: event.selectedIndex }
                    : state.approvalInput,
            });
        case 'question.menu.move':
            return withDerivedChrome({
                ...state,
                questionInput: state.pendingQuestion && state.questionInput
                    ? { ...state.questionInput, selectedIndex: event.selectedIndex }
                    : state.questionInput,
            });
        case 'question.toggle-option': {
            if (!state.pendingQuestion || !state.questionInput) {
                return state;
            }
            const selectedSet = new Set(state.questionInput.selected);
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
                questionInput: {
                    ...state.questionInput,
                    selected: Array.from(selectedSet),
                },
            });
        }
        case 'question.custom.append':
            return withDerivedChrome({
                ...state,
                questionInput: state.pendingQuestion && state.questionInput
                    ? { ...state.questionInput, customText: state.questionInput.customText + event.text }
                    : state.questionInput,
            });
        case 'question.custom.backspace':
            return withDerivedChrome({
                ...state,
                questionInput: state.pendingQuestion && state.questionInput
                    ? { ...state.questionInput, customText: state.questionInput.customText.slice(0, -1) }
                    : state.questionInput,
            });
        case 'diff.context.toggle':
            {
            const expanded = state.diffExpandedBlockIds.includes(event.blockId);
            const nextExpanded = expanded
                ? state.diffExpandedBlockIds.filter((id) => id !== event.blockId)
                : [...state.diffExpandedBlockIds, event.blockId];
            return withDerivedChrome({
                ...state,
                diffExpandedBlockIds: nextExpanded,
                uiNotice: expanded ? 'Diff context folded' : 'Diff context expanded',
            });
            }
        case 'context.group.toggle': {
            const expanded = state.expandedContextGroupIds.includes(event.entryId);
            const nextExpanded = expanded
                ? state.expandedContextGroupIds.filter((id) => id !== event.entryId)
                : [...state.expandedContextGroupIds, event.entryId];
            return withDerivedChrome({
                ...state,
                expandedContextGroupIds: nextExpanded,
                uiNotice: expanded ? 'Context group collapsed' : 'Context group expanded',
            });
        }
        case 'resize': {
            const innerWidth = Math.max(20, event.size.width - 2);
            const sidebarWidth = state.sidebar.length > 0
                ? Math.max(22, Math.min(46, Math.round(innerWidth * 0.30)))
                : 0;
            const mainWidth = Math.max(20, innerWidth - sidebarWidth);
            const editorContentWidth = Math.max(10, mainWidth - 8);
            const next = reduceTerminalRuntimeResize(state, event.size);
            const nextWithEditor = {
                ...next,
                editor: reduceEditorModel(next.editor, { type: 'set-content-width', width: editorContentWidth }),
            };
            return syncTranscriptViewport(syncLogViewport(nextWithEditor));
        }
        case 'runtime':
            return applyRuntimeEvent(state, event.event);
        case 'ui.tool.feedback.called':
        case 'ui.tool.feedback.output':
        case 'ui.tool.feedback.completed':
            return syncTranscriptViewport(reduceUiToolFeedbackToTerminalState(state, event));
        case 'shell': {
            const newLogLines = event.chunk.split(/\n/);
            const logLines = [...state.logLines, ...newLogLines];
            const nextState = reduceProtocolEventToTerminalState({
                ...state,
                transcriptEntries: [...state.transcriptEntries, {
                    id: `shell:${event.commandId ?? 'default'}:${Date.now()}`,
                    role: 'system',
                    content: event.chunk,
                }],
                logLines,
            }, {
                type: 'status.changed',
                sessionId: state.activeSessionId ?? 'shell-session',
                timestamp: Date.now(),
                source: 'runtime',
                status: 'done',
            });
            return syncLogViewport(nextState);
        }
        case 'viewport.scroll': {
            if (state.page === 'chat') {
                return scrollChatViewport(state, event.delta);
            }
            return scrollLogViewport(state, event.delta);
        }
        case 'viewport.page': {
            if (state.page === 'chat') {
                return pageChatViewport(state, event.direction);
            }
            return pageLogViewport(state, event.direction);
        }
        case 'viewport.home':
            if (state.page === 'chat') {
                return moveChatViewportToTop(state);
            }
            return moveLogViewportHome(state);
        case 'viewport.end': {
            if (state.page === 'chat') {
                return moveChatViewportToBottom(state);
            }
            return moveLogViewportEnd(state);
        }
        case 'viewport.intent.setTopLine': {
            if (state.page === 'chat') {
                return setChatViewportTopLine(state, event.topLine);
            }
            return setLogViewportTopLineIntent(state, event.topLine);
        }
        case 'viewport.intent.scrollbar': {
            if (state.page === 'chat') {
                return applyChatViewportIntent(state, {
                    kind: 'scrollbar',
                    lineCount: state.transcriptLines.length,
                    height: getChatViewportHeight(state),
                    pointerRow: event.pointerRow,
                    dragOffset: event.dragOffset ?? 0,
                });
            }
            return applyLogViewportScrollbar(state, event.pointerRow, event.dragOffset ?? 0);
        }
        case 'viewport.intent.jump': {
            if (state.page === 'chat') {
                return applyChatViewportIntent(state, {
                    kind: 'jump',
                    lineCount: state.transcriptLines.length,
                    height: getChatViewportHeight(state),
                    targetLine: event.targetLine,
                    anchorNumerator: event.anchorNumerator ?? 1,
                    anchorDenominator: event.anchorDenominator ?? 3,
                });
            }
            return state;
        }
        case 'viewport.selection.set':
            return {
                ...state,
                viewport: { ...state.viewport, selectedRange: event.selection },
            };
        case 'viewport.focusLine.set':
            return {
                ...state,
                viewport: { ...state.viewport, anchorMessageId: event.line },
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
                if (input.button === 'wheelUp') {
                    if (state.page === 'chat') {
                        return scrollChatViewport(state, -VIEWPORT_SCROLL_STEP);
                    }
                    return scrollLogViewport(state, -VIEWPORT_SCROLL_STEP);
                }
                if (input.button === 'wheelDown') {
                    if (state.page === 'chat') {
                        return scrollChatViewport(state, VIEWPORT_SCROLL_STEP);
                    }
                    return scrollLogViewport(state, VIEWPORT_SCROLL_STEP);
                }
                return state;
            }

            if (input.type === 'key' && input.ctrl && !input.alt) {
            switch (input.key) {
                    case 'a':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-boundary', edge: 'start' }) };
                    case 'e':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-boundary', edge: 'end' }) };
                    case 'b':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-horizontal', delta: -1 }) };
                    case 'f':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-horizontal', delta: 1 }) };
                    case 'd':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-part-forward' }) };
                    case 'j':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'insert-text', text: '\n' }) };
                    case 'k':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-to-line-end' }) };
                    case 'w':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-word-backward' }) };
                    case 'up': {
                        const starts = state.transcriptEntryLineStarts ?? [];
                        if (starts.length === 0) return state;
                        const currentTopLine = state.viewport.scrollOffset;

                        const currentLine = typeof state.viewport.anchorMessageId === 'number'
                            ? state.viewport.anchorMessageId
                            : currentTopLine;
                        let currentIdx = -1;
                        for (let i = 0; i < starts.length; i += 1) {
                            if (starts[i]! <= currentLine) currentIdx = i;
                            else break;
                        }

                        const targetIdx = Math.max(0, currentIdx - 1);
                        const targetLine = starts[targetIdx] ?? 0;
                        if (state.page === 'chat') {
                            const nextState = setChatViewportTopLine(state, targetLine);
                            return { ...nextState, viewport: { ...nextState.viewport, anchorMessageId: targetLine } };
                        }
                        const nextState = setLogViewportTopLineIntent(state, Math.max(0, state.logViewport.scrollOffset - 1));
                        return { ...nextState, logViewport: { ...nextState.logViewport, anchorMessageId: nextState.logViewport.scrollOffset } };
                    }
                    case 'down': {
                        const starts = state.transcriptEntryLineStarts ?? [];
                        if (starts.length === 0) return state;
                        const currentTopLine = state.viewport.scrollOffset;

                        const currentLine = typeof state.viewport.anchorMessageId === 'number'
                            ? state.viewport.anchorMessageId
                            : currentTopLine;
                        let currentIdx = -1;
                        for (let i = 0; i < starts.length; i += 1) {
                            if (starts[i]! <= currentLine) currentIdx = i;
                            else break;
                        }

                        const nextIdx = currentIdx < 0 ? 0 : Math.min(starts.length - 1, currentIdx + 1);
                        const targetLine = starts[nextIdx] ?? 0;
                        if (state.page === 'chat') {
                            const nextState = setChatViewportTopLine(state, targetLine);
                            return { ...nextState, viewport: { ...nextState.viewport, anchorMessageId: targetLine } };
                        }
                        const nextState = setLogViewportTopLineIntent(state, state.logViewport.scrollOffset + 1);
                        return { ...nextState, logViewport: { ...nextState.logViewport, anchorMessageId: nextState.logViewport.scrollOffset } };
                    }
                    default:
                        break;
                }
            }

            if (input.type === 'key' && input.alt && !input.ctrl) {
                switch (input.key) {
                    case 'b':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-word', direction: 'backward' }) };
                    case 'f':
                        return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-word', direction: 'forward' }) };
                    default:
                        break;
                }
            }

                switch (input.key) {
                case 'g': {
                    if (state.page === 'chat') {
                        const nextState = moveChatViewportToTop(state);
                        return { ...nextState, viewport: { ...nextState.viewport, anchorMessageId: 0 } };
                    }
                    const nextState = moveLogViewportHome(state);
                    return { ...nextState, logViewport: { ...nextState.logViewport, anchorMessageId: 0 } };
                }
                case 'G': {
                    if (state.page === 'chat') {
                        const nextState = moveChatViewportToBottom(state);
                        return { ...nextState, viewport: { ...nextState.viewport, anchorMessageId: nextState.viewport.scrollOffset } };
                    }
                    const nextState = moveLogViewportEnd(state);
                    return { ...nextState, logViewport: { ...nextState.logViewport, anchorMessageId: nextState.logViewport.scrollOffset } };
                }
                case 'backspace':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-part-backward' }) };
                case 'delete':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-part-forward' }) };
                case 'delete-to-line-start':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'delete-to-line-start' }) };
                case 'left':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-horizontal', delta: -1 }) };
                case 'right':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-horizontal', delta: 1 }) };
                case 'up':
                    if (input.shift) {
                        if (state.page === 'chat') {
                            return scrollChatViewport(state, -VIEWPORT_SCROLL_STEP);
                        }
                        return scrollLogViewport(state, -VIEWPORT_SCROLL_STEP);
                    }
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-vertical', delta: -1 }) };
                case 'down':
                    if (input.shift) {
                        if (state.page === 'chat') {
                            return scrollChatViewport(state, VIEWPORT_SCROLL_STEP);
                        }
                        return scrollLogViewport(state, VIEWPORT_SCROLL_STEP);
                    }
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-vertical', delta: 1 }) };
                case 'home':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-boundary', edge: 'start' }) };
                case 'end':
                    return { ...state, editor: reduceEditorModel(state.editor, { type: 'move-part-boundary', edge: 'end' }) };
                case 'pageup':
                    if (state.page === 'chat') {
                        return pageChatViewport(state, 'up');
                    }
                    return pageLogViewport(state, 'up');
                case 'pagedown':
                    if (state.page === 'chat') {
                        return pageChatViewport(state, 'down');
                    }
                    return pageLogViewport(state, 'down');
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
            return withDerivedChrome({
                ...state,
                uiNotice: event.notice,
            });
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
            return syncTranscriptViewport({
                ...next,
                modifiedFiles: [],
            });
        }
        case 'session.new': {
            const next = withDerivedChrome({
                ...state,
                activeSessionId: undefined,
                runtimeStatus: 'idle',
                runtimeNotice: undefined,
                uiNotice: 'New session (send a message to start)',
                pendingApproval: undefined,
                approvalInput: undefined,
                pendingQuestion: undefined,
                questionInput: undefined,
                transcriptEntries: [],
                title: 'New Session',
                modifiedFiles: [],
            });
            return syncTranscriptViewport(next);
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
            return openOverlay(state, event);
        case 'overlay.modelSetProvider':
            return setOverlayModelProvider(state, event);
        case 'overlay.commandsFilter':
            return filterCommandsOverlay(state, event);
        case 'overlay.filepickerEnterDir':
            return enterFilepickerDir(state, event);
        case 'overlay.filepickerGoParent':
            return goFilepickerParent(state, event);
        case 'overlay.filepickerInputMode':
            return setFilepickerInputMode(state, event);
        case 'overlay.filepickerPathEdit':
            return editFilepickerPath(state, event);
        case 'overlay.completeExpand':
            return expandCompleteOverlay(state, event);
        case 'overlay.completeCollapse':
            return collapseCompleteOverlay(state, event);
        case 'overlay.completeScrollAt':
            return scrollCompleteOverlayAt(state, event);
        case 'overlay.completeSetSelected':
            return setCompleteOverlaySelected(state, event);
        case 'overlay.move':
            return moveOverlaySelection(state, event);
        case 'overlay.argumentsEdit':
            return editArgumentsOverlay(state, event);
        case 'overlay.argumentsAdvance':
            return advanceArgumentsOverlay(state, event);
        case 'overlay.close':
            return closeOverlay(state);
        case 'overlay.closeWithSelect':
            return closeOverlayWithSelect(state, event);
        case 'model.set':
            return withDerivedChrome({ ...state, model: event.model });
        case 'page.toggle':
            return syncTranscriptViewport(syncLogViewport({ ...state, page: state.page === 'chat' ? 'logs' : 'chat' }));
        case 'logViewport.scroll':
            return scrollLogViewport(state, event.delta);
        case 'logViewport.page':
            return pageLogViewport(state, event.direction);
        case 'logViewport.home':
            return moveLogViewportHome(state);
        case 'logViewport.end':
            return moveLogViewportEnd(state);
        case 'modifiedFiles.add': {
            const paths = state.modifiedFiles.includes(event.path) ? state.modifiedFiles : [...state.modifiedFiles, event.path];
            return { ...state, modifiedFiles: paths };
        }
        case 'modifiedFiles.clear':
            return { ...state, modifiedFiles: [] };
        case 'interaction.mode.toggle': {
            const nextMode = state.interactionMode === 'build' ? 'plan' : 'build';
            return withDerivedChrome({
                ...state,
                interactionMode: nextMode,
                uiNotice: nextMode === 'plan'
                    ? 'Plan mode enabled'
                    : 'Build mode enabled',
            });
        }
        case 'timer':
            if (state.runtimeStatus !== 'thinking' && state.runtimeStatus !== 'running-tool') {
                if (state.runtimePulseFrame === 0) return state;
                return withDerivedChrome({ ...state, runtimePulseFrame: 0 });
            }
            return withDerivedChrome({
                ...state,
                runtimePulseFrame: (state.runtimePulseFrame + 1) % 4,
            });
        default:
            return state;
    }
}
