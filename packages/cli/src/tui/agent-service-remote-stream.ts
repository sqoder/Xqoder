import { getMessageAttachmentKind, type MessageAttachment as SharedMessageAttachment } from '@xqoder/shared';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import type { AppEvent } from '@xqoder/protocol';

type RemoteStreamRecord =
    | { type: 'event'; streamId: string; seq: number; cursor: number; event: AppEvent }
    | { type: 'done'; streamId: string; seq: number; cursor: number; response?: string; sessionId?: string }
    | { type: 'error'; streamId: string; seq: number; cursor: number; message?: string }
    | { type: 'cancelled'; streamId: string; seq: number; cursor: number; reason?: string };

export interface RemoteMessageCallbacks {
    onEvent: (event: AppEvent) => void;
    onQuestion?: (request: QuestionPrompt) => Promise<QuestionAnswer>;
}

export interface RemoteStreamRunnerOptions {
    fetchImpl: typeof fetch;
    streamUrl: string;
    sessionId: string;
    message: string;
    attachments: SharedMessageAttachment[];
    callbacks: RemoteMessageCallbacks;
    buildHeaders: () => Record<string, string>;
    postQuestionResolve: (
        sessionId: string,
        requestId: string,
        answer: { selected: string[]; customText?: string; streamId?: string },
    ) => Promise<void>;
    setActiveAbortController: (controller: AbortController | null) => void;
    setActiveStreamMeta: (meta: { sessionId: string; streamId: string } | null) => void;
    waitForReconnectAttempt?: (attempt: number) => Promise<void>;
    timeoutMs?: number;
    maxReconnectAttempts?: number;
}

export function emitRemoteUserMessage(
    callbacks: RemoteMessageCallbacks,
    sessionId: string,
    message: string,
): void {
    const userMsgId = `remote:user:${Date.now()}`;
    callbacks.onEvent({
        type: 'message.started',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        message: { id: userMsgId, sessionId, role: 'user', content: message, createdAt: Date.now() },
    });
    callbacks.onEvent({
        type: 'message.completed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        message: { id: userMsgId, sessionId, role: 'user', content: message, createdAt: Date.now() },
    });
}

export function createRemoteAttachmentPayload(attachments: SharedMessageAttachment[]) {
    return attachments.length > 0
        ? attachments.map((attachment) => {
            const kind = getMessageAttachmentKind(attachment);
            return {
                kind,
                ...(attachment.type ? { type: attachment.type } : {}),
                mimeType: attachment.mimeType,
                data: attachment.data,
                filePath: attachment.filePath,
                fileName: attachment.fileName,
            };
        })
        : undefined;
}

export function createReconnectFailureError(maxReconnectAttempts: number, sessionId: string, streamId: string, cause: unknown): Error {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new Error(
        `Remote stream reconnection failed after ${maxReconnectAttempts} attempts`
        + ` for session ${sessionId} (${streamId}): ${message}`,
    );
}

export async function waitForRemoteReconnectAttempt(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 250 * attempt)));
}

async function resolveQuestionAnswer(
    callbacks: RemoteMessageCallbacks,
    event: Extract<RemoteStreamRecord, { type: 'event' }>['event'] & { type: 'question.requested' },
): Promise<QuestionAnswer> {
    if (callbacks.onQuestion) {
        return await callbacks.onQuestion({
            requestId: event.requestId,
            question: event.question,
            header: event.header,
            options: event.options,
            multiple: event.multiple,
            allowCustom: event.allowCustom,
        });
    }

    return {
        requestId: event.requestId,
        selected: event.options.length > 0 ? [event.options[0]!.label] : [],
    };
}

async function handleRemoteEventRecord(
    record: Extract<RemoteStreamRecord, { type: 'event' }>,
    sessionId: string,
    streamId: string | undefined,
    callbacks: RemoteMessageCallbacks,
    postQuestionResolve: RemoteStreamRunnerOptions['postQuestionResolve'],
): Promise<void> {
    callbacks.onEvent(record.event);

    if (record.event.type !== 'question.requested') {
        return;
    }

    const answer = await resolveQuestionAnswer(callbacks, record.event);
    await postQuestionResolve(sessionId, record.event.requestId, {
        selected: answer.selected,
        ...(answer.customText ? { customText: answer.customText } : {}),
        ...(streamId ? { streamId } : {}),
    });
}

function parseRemoteStreamRecord(raw: string): RemoteStreamRecord {
    return JSON.parse(raw) as RemoteStreamRecord;
}

export async function runRemoteMessageStream(options: RemoteStreamRunnerOptions): Promise<{ sessionId: string }> {
    const timeoutMs = options.timeoutMs ?? 45000;
    const maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    const waitForReconnectAttempt = options.waitForReconnectAttempt ?? waitForRemoteReconnectAttempt;
    const body = {
        message: options.message,
        attachments: createRemoteAttachmentPayload(options.attachments),
    };

    let resolvedSessionId = options.sessionId;
    let reconnectAttempts = 0;
    let streamId: string | undefined;
    let cursor = 0;
    let completed = false;

    while (!completed) {
        const attemptBody = streamId
            ? { streamId, cursor, timeoutMs }
            : { ...body, timeoutMs };

        const controller = new AbortController();
        options.setActiveAbortController(controller);
        const timer = setTimeout(() => {
            controller.abort(new Error(`Stream request timed out (${timeoutMs}ms)`));
        }, timeoutMs);
        timer.unref?.();

        let streamRes: Response;
        try {
            streamRes = await options.fetchImpl(options.streamUrl, {
                method: 'POST',
                headers: options.buildHeaders(),
                body: JSON.stringify(attemptBody),
                signal: controller.signal,
            });
        } catch (err) {
            clearTimeout(timer);
            if (!streamId) {
                throw err instanceof Error ? err : new Error(String(err));
            }
            if (reconnectAttempts >= maxReconnectAttempts) {
                throw createReconnectFailureError(maxReconnectAttempts, options.sessionId, streamId, err);
            }
            reconnectAttempts += 1;
            await waitForReconnectAttempt(reconnectAttempts);
            continue;
        }

        clearTimeout(timer);

        if (!streamRes.ok) {
            const text = await streamRes.text();
            throw new Error(`API ${streamRes.status}: ${text || streamRes.statusText}`);
        }

        if (!streamRes.body) {
            throw new Error('Remote stream response has no body');
        }

        const decoder = new TextDecoder();
        const reader = streamRes.body.getReader();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                let newline = buffer.indexOf('\n');
                while (newline !== -1) {
                    const rawLine = buffer.slice(0, newline).trim();
                    buffer = buffer.slice(newline + 1);
                    newline = buffer.indexOf('\n');

                    if (!rawLine) {
                        continue;
                    }

                    const record = parseRemoteStreamRecord(rawLine);

                    if ('streamId' in record && !streamId) {
                        streamId = record.streamId;
                        options.setActiveStreamMeta({ sessionId: options.sessionId, streamId });
                    }
                    if ('seq' in record && Number.isFinite(record.seq)) {
                        cursor = Math.max(cursor, record.seq);
                    }

                    if (record.type === 'event') {
                        await handleRemoteEventRecord(
                            record,
                            options.sessionId,
                            streamId,
                            options.callbacks,
                            options.postQuestionResolve,
                        );
                        continue;
                    }

                    if (record.type === 'done') {
                        if (record.sessionId) {
                            resolvedSessionId = record.sessionId;
                        }
                        completed = true;
                        continue;
                    }

                    if (record.type === 'cancelled') {
                        throw new Error(record.reason ?? 'Remote stream cancelled');
                    }

                    if (record.type === 'error') {
                        throw new Error(record.message ?? 'Remote message stream failed');
                    }
                }
            }
        } catch (err) {
            if (completed) {
                break;
            }
            if (!streamId) {
                throw err instanceof Error ? err : new Error(String(err));
            }
            if (reconnectAttempts >= maxReconnectAttempts) {
                throw createReconnectFailureError(maxReconnectAttempts, options.sessionId, streamId, err);
            }
            reconnectAttempts += 1;
            await waitForReconnectAttempt(reconnectAttempts);
            continue;
        }

        const trailing = buffer.trim();
        if (trailing) {
            const record = parseRemoteStreamRecord(trailing);
            if ('streamId' in record && !streamId) {
                streamId = record.streamId;
                options.setActiveStreamMeta({ sessionId: options.sessionId, streamId });
            }
            if ('seq' in record && Number.isFinite(record.seq)) {
                cursor = Math.max(cursor, record.seq);
            }
            if (record.type === 'event') {
                options.callbacks.onEvent(record.event);
            } else if (record.type === 'done') {
                if (record.sessionId) {
                    resolvedSessionId = record.sessionId;
                }
                completed = true;
            } else if (record.type === 'cancelled') {
                throw new Error(record.reason ?? 'Remote stream cancelled');
            } else if (record.type === 'error') {
                throw new Error(record.message ?? 'Remote message stream failed');
            }
        }

        if (!completed && streamId) {
            reconnectAttempts += 1;
            if (reconnectAttempts > maxReconnectAttempts) {
                throw createReconnectFailureError(
                    maxReconnectAttempts,
                    options.sessionId,
                    streamId,
                    new Error('Remote stream ended unexpectedly without completion'),
                );
            }
        }
    }

    return { sessionId: resolvedSessionId };
}
