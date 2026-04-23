import type { AgentCallbacks } from '@xqoder/agent';
import type { MessageAttachment } from '@xqoder/shared';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type {
    AppEvent,
    ConversationEventEnvelope,
    CoreMessage,
    JsonValue,
    MessageAttachment as ProtocolMessageAttachment,
} from '@xqoder/protocol';
import {
    resolveDirectCommandSessionId,
} from './direct-command.js';
import type { PreparedChatExecution } from './turn-intake.js';

export function createEnvelopeCallbackBridge(callbacks: AgentCallbacks): {
    onEvent: (event: ConversationEventEnvelope) => void;
} {
    const streamedAssistantMessages = new Set<string>();
    const toolOutputs = new Map<string, string>();

    return {
        onEvent(event) {
            switch (event.type) {
                case 'message.delta':
                    if (event.payload.role !== 'assistant') {
                        return;
                    }
                    streamedAssistantMessages.add(event.payload.messageId);
                    try { callbacks.onToken?.(event.payload.text); } catch { /* noop */ }
                    return;
                case 'message.completed':
                    if (event.payload.message.role !== 'assistant') {
                        return;
                    }
                    if (!streamedAssistantMessages.has(event.payload.message.id)) {
                        try { callbacks.onToken?.(event.payload.message.content); } catch { /* noop */ }
                    }
                    streamedAssistantMessages.delete(event.payload.message.id);
                    return;
                case 'thought':
                    try { callbacks.onThinkingToken?.(event.payload.text); } catch { /* noop */ }
                    return;
                case 'tool.called':
                    try { callbacks.onToolStart?.(event.payload.tool, normalizeEnvelopeToolArgs(event.payload.args)); } catch { /* noop */ }
                    return;
                case 'tool.output':
                    if (event.payload.partial === true) {
                        try { callbacks.onToolStream?.(event.payload.tool, event.payload.output, 'stdout'); } catch { /* noop */ }
                        return;
                    }
                    toolOutputs.set(event.payload.tool, event.payload.output);
                    return;
                case 'tool.completed':
                    try {
                        callbacks.onToolEnd?.(
                            event.payload.tool,
                            toolOutputs.get(event.payload.tool) ?? '',
                            event.payload.success,
                        );
                    } catch { /* noop */ }
                    toolOutputs.delete(event.payload.tool);
                    return;
                case 'error':
                    try { callbacks.onError?.(new Error(event.payload.message)); } catch { /* noop */ }
                    return;
                default:
                    return;
            }
        },
    };
}

export function getSessionMessageCount(
    session: PreparedChatExecution['agentConfig']['session'],
): number {
    if (!session || typeof (session as { getMessages?: unknown }).getMessages !== 'function') {
        return 0;
    }

    return (session as { getMessages: () => unknown[] }).getMessages().length;
}

export function emitDirectChatMessageStream(
    execution: PreparedChatExecution,
    options: {
        onEvent: (event: ConversationEventEnvelope) => void;
    },
    response: string,
): { response: string; sessionId: string } {
    const sessionId = resolveDirectCommandSessionId(execution);
    const userMessageId = `${sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${sessionId}:assistant:${Date.now()}`;
    const now = Date.now();
    const userMessage = createCoreMessage({
        id: userMessageId,
        sessionId,
        role: 'user',
        content: execution.turnInput.rawPrompt,
        createdAt: now,
        attachments: execution.turnInput.attachments,
    });
    const assistantMessage = createCoreMessage({
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: response,
        createdAt: now + 1,
    });
    const eventEmitter = createConversationEventEnvelopeEmitter(sessionId);

    const emitEvent = (event: AppEvent): void => {
        const envelope = eventEmitter.emit(event);
        execution.agentConfig.session?.recordConversationEnvelopeEvent(envelope);
        options.onEvent(envelope);
    };

    emitEvent(
        execution.agentConfig.session
            ? {
                type: 'session.resumed',
                sessionId,
                timestamp: now,
                source: 'runtime',
                messageCount: getSessionMessageCount(execution.agentConfig.session),
            }
            : {
                type: 'session.started',
                sessionId,
                timestamp: now,
                source: 'runtime',
                cwd: execution.turnInput.resolvedDir,
            },
    );
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: userMessage,
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: userMessage,
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        status: 'thinking',
    });
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now + 1,
        source: 'runtime',
        message: {
            ...assistantMessage,
            content: '',
        },
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        message: assistantMessage,
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        status: 'done',
        stopReason: 'completed',
    });

    return {
        response,
        sessionId,
    };
}

export function createCoreMessage(input: {
    id: string;
    sessionId: string;
    role: CoreMessage['role'];
    content: string;
    createdAt: number;
    attachments?: MessageAttachment[];
}): CoreMessage {
    return {
        id: input.id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        createdAt: input.createdAt,
        ...(input.attachments && input.attachments.length > 0
            ? {
                attachments: input.attachments.map(toProtocolAttachment),
            }
            : {}),
    };
}

function normalizeEnvelopeToolArgs(value: JsonValue | undefined): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function toProtocolAttachment(attachment: MessageAttachment): ProtocolMessageAttachment {
    return {
        kind: attachment.type,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
    };
}
