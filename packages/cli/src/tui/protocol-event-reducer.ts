import type { AppEvent, CoreMessage } from '@xqoder/protocol';
import type { ToolExecution } from './layout.js';
import type { ChatMessage } from './message.js';

export interface ProtocolUiState {
    messages: ChatMessage[];
    toolExecutions: ToolExecution[];
    selectedToolExecutionIndex: number;
    infoMessage: string;
    status: 'idle' | 'running';
}

export interface ProtocolUiReducerOptions {
    sanitizeAssistantText: (text: string) => string;
}

export const INITIAL_PROTOCOL_UI_STATE: ProtocolUiState = {
    messages: [],
    toolExecutions: [],
    selectedToolExecutionIndex: 0,
    infoMessage: '',
    status: 'idle',
};

function messageToAttachments(message: CoreMessage): string[] | undefined {
    const filePaths = (message.attachments ?? [])
        .map((attachment) => attachment.filePath)
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

    return filePaths.length > 0 ? filePaths : undefined;
}

function toChatMessage(message: CoreMessage, options: ProtocolUiReducerOptions): ChatMessage {
    return {
        id: message.id,
        type: message.role === 'tool' ? 'tool' : message.role,
        content: message.role === 'user' ? message.content : options.sanitizeAssistantText(message.content),
        timestamp: new Date(message.createdAt),
        ...(message.role === 'tool' && message.toolCallId ? { toolName: message.toolCallId } : {}),
        ...(messageToAttachments(message) ? { attachments: messageToAttachments(message) } : {}),
    } satisfies ChatMessage;
}

function upsertMessage(messages: ChatMessage[], nextMessage: ChatMessage): ChatMessage[] {
    const index = messages.findIndex((message) => message.id === nextMessage.id);
    if (index === -1) {
        return [...messages, nextMessage];
    }

    const updated = [...messages];
    updated[index] = { ...updated[index]!, ...nextMessage };
    return updated;
}

export function reduceProtocolEvent(
    state: ProtocolUiState,
    event: AppEvent,
    options: ProtocolUiReducerOptions,
): ProtocolUiState {
    switch (event.type) {
        case 'message.started': {
            const baseMessage = toChatMessage(event.message, options);
            const nextMessage = event.message.role === 'assistant'
                ? {
                    ...baseMessage,
                    content: baseMessage.content || 'Thinking...',
                    isStreaming: true,
                }
                : baseMessage;

            return {
                ...state,
                messages: upsertMessage(state.messages, nextMessage),
            };
        }

        case 'message.delta': {
            const messages = state.messages.map((message) => {
                if (message.id !== event.messageId) {
                    return message;
                }

                const nextContent = options.sanitizeAssistantText(
                    message.content === 'Thinking...'
                        ? event.text
                        : `${message.content}${event.text}`,
                );

                return {
                    ...message,
                    content: nextContent,
                    isStreaming: true,
                };
            });

            return {
                ...state,
                messages,
            };
        }

        case 'message.completed': {
            return {
                ...state,
                messages: upsertMessage(state.messages, {
                    ...toChatMessage(event.message, options),
                    isStreaming: false,
                }),
            };
        }

        case 'tool.called': {
            const nextExecutions = [...state.toolExecutions, {
                id: `${event.sessionId}:${event.tool}:${event.timestamp}`,
                name: event.tool,
                args: typeof event.args === 'object' && event.args && !Array.isArray(event.args)
                    ? event.args as Record<string, unknown>
                    : {},
                startedAt: new Date(event.timestamp),
            }];

            return {
                ...state,
                toolExecutions: nextExecutions,
                selectedToolExecutionIndex: Math.max(0, nextExecutions.length - 1),
                infoMessage: `Tool: ${event.tool}`,
                status: 'running',
            };
        }

        case 'tool.output': {
            const toolExecutions = [...state.toolExecutions];
            for (let index = toolExecutions.length - 1; index >= 0; index -= 1) {
                const execution = toolExecutions[index]!;
                if (execution.name !== event.tool || execution.endedAt) {
                    continue;
                }

                toolExecutions[index] = {
                    ...execution,
                    output: event.partial
                        ? `${execution.output ?? ''}${event.output}`
                        : event.output,
                };
                break;
            }

            return {
                ...state,
                toolExecutions,
            };
        }

        case 'tool.completed': {
            const toolExecutions = [...state.toolExecutions];
            for (let index = toolExecutions.length - 1; index >= 0; index -= 1) {
                const execution = toolExecutions[index]!;
                if (execution.name !== event.tool || execution.endedAt) {
                    continue;
                }

                toolExecutions[index] = {
                    ...execution,
                    endedAt: new Date(event.timestamp),
                    success: event.success,
                };
                break;
            }

            return {
                ...state,
                toolExecutions,
                infoMessage: event.success ? 'Thinking...' : `Tool failed: ${event.tool}`,
            };
        }

        case 'question.requested': {
            const title = event.header ? `${event.header}: ` : '';
            return {
                ...state,
                status: 'running',
                infoMessage: `${title}${event.question}`.slice(0, 80),
            };
        }

        case 'question.resolved': {
            const selected = event.selected.length > 0 ? event.selected.join(', ') : 'none';
            return {
                ...state,
                infoMessage: `Question resolved: ${selected}`,
            };
        }

        case 'status.changed': {
            return {
                ...state,
                status: event.status === 'done' || event.status === 'error' ? 'idle' : 'running',
                infoMessage: event.status === 'done'
                    ? 'Done'
                    : event.status === 'running-tool'
                        ? 'Running tool...'
                        : event.status === 'error'
                            ? state.infoMessage
                            : 'Thinking...',
            };
        }

        case 'error': {
            return {
                ...state,
                status: 'idle',
                infoMessage: `Error: ${event.message.slice(0, 60)}`,
                messages: upsertMessage(state.messages, {
                    id: `${event.sessionId}:error:${event.timestamp}`,
                    type: 'system',
                    content: `Error: ${event.message}`,
                    timestamp: new Date(event.timestamp),
                }),
            };
        }

        default:
            return state;
    }
}
