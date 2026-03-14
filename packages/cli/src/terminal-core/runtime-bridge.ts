import type { AppEvent } from '@xqoder/protocol';
import type { LLMMessage } from '@xqoder/shared';
import type { TerminalAppState, TerminalTranscriptEntry } from './app-state.js';
import { getEditorViewModel } from './editor-model.js';
import type { TerminalCoreEvent } from './types.js';
import { rebuildTranscriptWithCodeBlocks } from './transcript-blocks.js';
import { getApprovalStatusHint, getOverlayStatusHint, getQuestionStatusHint } from './interaction-protocol.js';

function getTranscriptWidth(state: TerminalAppState): number {
    const sidebarWidth = 0;
    const mainWidth = Math.max(20, state.size.width - sidebarWidth);
    return Math.max(10, mainWidth - 1);
}

/** Transcript area height (rows) for viewport math. Matches renderer layout. */
export function getTranscriptHeight(state: TerminalAppState): number {
    const editorView = getEditorViewModel(state.editor);
    const editorHeight = Math.max(3, editorView.visibleLines.length + state.editor.attachments.length + 2);
    const statusHeight = 1;
    return Math.max(5, state.size.height - editorHeight - statusHeight - 1);
}


function buildSidebar(state: TerminalAppState): TerminalAppState['sidebar'] {
    const sections: TerminalAppState['sidebar'] = [
        {
            title: 'Context',
            lines: [
                state.cwd ?? '(no cwd)',
                state.model ? `Model: ${state.model}` : 'Model: unknown',
                state.agent ? `Agent: ${state.agent}` : 'Agent: unknown',
            ],
        },
        {
            title: 'Session',
            lines: [state.activeSessionId ?? 'not started'],
        },
    ];
    if (state.modifiedFiles && state.modifiedFiles.length > 0) {
        sections.push({
            title: 'Modified',
            lines: state.modifiedFiles.map((p) => p.split(/[/\\]/).pop() ?? p),
        });
    }

    if (state.pendingApproval) {
        sections.push({
            title: 'Approval',
            lines: [
                state.pendingApproval.summary,
                state.pendingApproval.payload ?? '1: Allow once  2: Always allow (session)  3: Deny',
            ],
        });
    }

    if (state.pendingQuestion) {
        sections.push({
            title: 'Question',
            lines: [
                state.pendingQuestion.header ? `${state.pendingQuestion.header}: ${state.pendingQuestion.question}` : state.pendingQuestion.question,
                `${state.pendingQuestion.options.length} options${state.pendingQuestion.multiple ? ' (multi)' : ''}`,
            ],
        });
    }

    return sections;
}

function buildStatusItems(state: TerminalAppState): TerminalAppState['statusItems'] {
    return [
        { text: state.runtimeStatus },
        ...(state.notice ? [{ text: state.notice, tone: 'accent' as const }] : []),
        ...(state.model ? [{ text: state.model, tone: 'muted' as const }] : []),
        ...(state.transcriptCodeBlocks.length > 0 ? [{ text: 'Alt+C / Ctrl+Shift+C 复制代码块', tone: 'muted' as const }] : []),
        ...(state.transcriptEntries.length > 0 ? [{ text: 'y 复制消息  Y 复制代码块', tone: 'muted' as const }] : []),
        ...(process.platform === 'darwin' ? [{ text: '⌘+C 复制选中', tone: 'muted' as const }] : []),
        ...(state.editor.value.length > 0 ? [{ text: 'Ctrl+U 删至行首', tone: 'muted' as const }] : []),
        { text: process.platform === 'darwin' ? '⌘+V 粘贴' : 'Ctrl+V 粘贴', tone: 'muted' as const },
        ...(state.pendingApproval
            ? [{
                text: getApprovalStatusHint(),
                tone: 'accent' as const,
            }]
            : []),
        ...(state.pendingQuestion
            ? [{
                text: getQuestionStatusHint(state.pendingQuestion.multiple),
                tone: 'accent' as const,
            }]
            : []),
        ...(state.overlay
            ? [{
                text: getOverlayStatusHint(state.overlay) ?? 'overlay active',
                tone: 'muted' as const,
            }]
            : []),
    ];
}

export function withDerivedChrome(state: TerminalAppState): TerminalAppState {
    const width = getTranscriptWidth(state);
    const { lines: transcriptLines, codeBlocks: transcriptCodeBlocks, entryLineRanges: transcriptEntryLineRanges } = rebuildTranscriptWithCodeBlocks(state.transcriptEntries, width);
    return {
        ...state,
        transcriptLines,
        transcriptCodeBlocks,
        transcriptEntryLineRanges,
        sidebar: buildSidebar(state),
        statusItems: buildStatusItems(state),
    };
}

function upsertTranscriptEntry(entries: TerminalTranscriptEntry[], nextEntry: TerminalTranscriptEntry): TerminalTranscriptEntry[] {
    const index = entries.findIndex((entry) => entry.id === nextEntry.id);
    if (index === -1) {
        return [...entries, nextEntry];
    }
    const next = [...entries];
    next[index] = { ...next[index]!, ...nextEntry };
    return next;
}

function appendTranscriptEntry(entries: TerminalTranscriptEntry[], nextEntry: TerminalTranscriptEntry): TerminalTranscriptEntry[] {
    return [...entries, nextEntry];
}

function findLatestToolEntry(entries: TerminalTranscriptEntry[], toolName: string): number {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.role === 'tool' && entry.id.includes(`:${toolName}:`) && entry.isStreaming) {
            return index;
        }
    }
    return -1;
}

function attachmentsFromEvent(event: Extract<AppEvent, { type: 'message.started' | 'message.completed' }>): string[] | undefined {
    const values = (event.message.attachments ?? [])
        .map((attachment) => attachment.filePath ?? attachment.fileName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return values.length > 0 ? values : undefined;
}

function buildHistoryEntries(messages: LLMMessage[]): TerminalTranscriptEntry[] {
    return messages.flatMap<TerminalTranscriptEntry>((message, index) => {
        if (message.role === 'system') {
            return [];
        }

        const attachments = (message.attachments ?? [])
            .map((attachment) => attachment.filePath ?? attachment.fileName)
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

        return [{
            id: `history:${index}`,
            role: message.role === 'tool' ? 'tool' : message.role,
            content: message.content,
            ...(attachments.length > 0 ? { attachments } : {}),
        }];
    });
}

export function restoreTerminalHistory(
    state: TerminalAppState,
    options: { sessionId: string; title?: string; cwd?: string; messages: LLMMessage[] },
): TerminalAppState {
    return withDerivedChrome({
        ...state,
        activeSessionId: options.sessionId,
        title: options.title ?? state.title,
        cwd: options.cwd ?? state.cwd,
        transcriptEntries: buildHistoryEntries(options.messages),
        notice: options.messages.length > 0 ? `restored ${options.messages.length} messages` : 'empty session',
    });
}

export function reduceProtocolEventToTerminalState(state: TerminalAppState, event: AppEvent): TerminalAppState {
    switch (event.type) {
        case 'session.started':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                cwd: event.cwd,
                runtimeStatus: 'idle',
                notice: 'session started',
            });
        case 'session.resumed':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                notice: `resumed ${event.messageCount} messages`,
            });
        case 'message.started':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                pendingApproval: undefined,
                pendingQuestion: undefined,
                transcriptEntries: upsertTranscriptEntry(state.transcriptEntries, {
                    id: event.message.id,
                    role: event.message.role === 'tool' ? 'tool' : event.message.role,
                    content: event.message.content || (event.message.role === 'assistant' ? 'Thinking...' : ''),
                    isStreaming: event.message.role === 'assistant',
                    attachments: attachmentsFromEvent(event),
                }),
            });
        case 'message.delta':
            return withDerivedChrome({
                ...state,
                transcriptEntries: state.transcriptEntries.map((entry) => {
                    if (entry.id !== event.messageId) {
                        return entry;
                    }
                    return {
                        ...entry,
                        content: entry.content === 'Thinking...' ? event.text : `${entry.content}${event.text}`,
                        isStreaming: true,
                    };
                }),
                runtimeStatus: 'thinking',
            });
        case 'message.completed':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                transcriptEntries: upsertTranscriptEntry(state.transcriptEntries, {
                    id: event.message.id,
                    role: event.message.role === 'tool' ? 'tool' : event.message.role,
                    content: event.message.content,
                    isStreaming: false,
                    attachments: attachmentsFromEvent(event),
                }),
                pendingApproval: undefined,
            });
        case 'tool.called':
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'running-tool',
                notice: `tool ${event.tool}`,
                transcriptEntries: appendTranscriptEntry(state.transcriptEntries, {
                    id: `${event.sessionId}:tool:${event.tool}:${event.timestamp}`,
                    role: 'tool',
                    content: `${event.tool}`,
                    isStreaming: true,
                }),
            });
        case 'tool.output': {
            const toolIndex = findLatestToolEntry(state.transcriptEntries, event.tool);
            if (toolIndex === -1) {
                return withDerivedChrome({
                    ...state,
                    notice: event.partial ? `tool ${event.tool} streaming` : `tool ${event.tool} output`,
                });
            }

            const transcriptEntries = [...state.transcriptEntries];
            const current = transcriptEntries[toolIndex]!;
            transcriptEntries[toolIndex] = {
                ...current,
                content: event.partial ? `${current.content}${event.output}` : event.output,
            };
            return withDerivedChrome({
                ...state,
                notice: event.partial ? `tool ${event.tool} streaming` : `tool ${event.tool} output`,
                transcriptEntries,
            });
        }
        case 'tool.completed':
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'thinking',
                notice: `${event.tool} ${event.success ? 'ok' : 'failed'}`,
                transcriptEntries: state.transcriptEntries.map((entry) => {
                    if (entry.role !== 'tool' || !entry.id.includes(`:${event.tool}:`) || !entry.isStreaming) {
                        return entry;
                    }
                    return {
                        ...entry,
                        isStreaming: false,
                        success: event.success,
                    };
                }),
            });
        case 'status.changed':
            return withDerivedChrome({
                ...state,
                runtimeStatus: event.status,
                notice: event.status,
            });
        case 'approval.requested':
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'awaiting-approval',
                notice: event.summary,
                pendingApproval: {
                    requestId: event.requestId,
                    kind: event.kind,
                    summary: event.summary,
                    payload: typeof event.payload === 'string' ? event.payload : undefined,
                    selectedIndex: 0,
                },
            });
        case 'approval.resolved':
            return withDerivedChrome({
                ...state,
                notice: `approval ${event.decision}`,
                pendingApproval: undefined,
            });
        case 'question.requested': {
            const selected = event.options.length > 0 ? [event.options[0]!.label] : [];
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'awaiting-approval',
                notice: event.header ? `${event.header}: ${event.question}` : event.question,
                pendingQuestion: {
                    requestId: event.requestId,
                    ...(event.header ? { header: event.header } : {}),
                    question: event.question,
                    options: event.options,
                    multiple: event.multiple,
                    allowCustom: event.allowCustom,
                    selectedIndex: 0,
                    selected,
                    customText: '',
                },
            });
        }
        case 'question.resolved':
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'thinking',
                notice: `question resolved: ${event.selected.join(', ') || 'none'}`,
                pendingQuestion: undefined,
            });
        case 'error':
            return withDerivedChrome({
                ...state,
                runtimeStatus: 'error',
                notice: event.message,
                pendingQuestion: undefined,
                transcriptEntries: [...state.transcriptEntries, {
                    id: `${event.sessionId}:error:${event.timestamp}`,
                    role: 'system',
                    content: `Error: ${event.message}`,
                }],
            });
        default:
            return withDerivedChrome(state);
    }
}

export function reduceTerminalCoreEventToState(state: TerminalAppState, event: TerminalCoreEvent): TerminalAppState {
    if (event.type === 'approval.menu.move' && state.pendingApproval) {
        return withDerivedChrome({
            ...state,
            pendingApproval: {
                ...state.pendingApproval,
                selectedIndex: event.selectedIndex,
            },
        });
    }
    return state;
}

export function reduceTerminalRuntimeResize(state: TerminalAppState, size: TerminalAppState['size']): TerminalAppState {
    return withDerivedChrome({
        ...state,
        size,
    });
}

export class ProtocolRuntimeBridge {
    constructor(private readonly dispatch: (event: TerminalCoreEvent) => void) {}

    onProtocolEvent(event: AppEvent): void {
        this.dispatch({ type: 'runtime', event });
    }
}
