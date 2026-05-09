import * as http from 'node:http';
import type { MessageAttachment } from '@xqoder/shared';
import type { ToolApprovalRequest } from '@xqoder/agent';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';

/**
 * Slice 0 boundary:
 * - transport/subscriber/wire protocol only
 * - no chat routing, tool policy, or agent-loop decisions should live here
 */

export interface PendingQuestionEntry {
    sessionId: string;
    streamId: string;
    requestId: string;
    fallbackSelected: string[];
    resolve: (answer: QuestionAnswer) => void;
    timeout: NodeJS.Timeout;
}

export interface PendingApprovalEntry {
    sessionId: string;
    streamId: string;
    requestId: string;
    fallbackDecision: 'allow' | 'deny';
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
}

export type StreamWireRecord =
    | { type: 'event'; streamId: string; seq: number; cursor: number; event: ConversationEventEnvelope }
    | { type: 'done'; streamId: string; seq: number; cursor: number; response: string; sessionId: string }
    | { type: 'error'; streamId: string; seq: number; cursor: number; message: string }
    | { type: 'cancelled'; streamId: string; seq: number; cursor: number; reason: string };

type StreamAppendRecord =
    | { type: 'event'; event: ConversationEventEnvelope }
    | { type: 'done'; response: string; sessionId: string }
    | { type: 'error'; message: string }
    | { type: 'cancelled'; reason: string };

interface StreamSubscriber {
    id: string;
    res: http.ServerResponse;
    lastSeq: number;
}

export interface StreamOperation {
    id: string;
    sessionId: string;
    projectRoot: string;
    message: string;
    attachments?: MessageAttachment[];
    createdAt: number;
    nextSeq: number;
    records: StreamWireRecord[];
    subscribers: Map<string, StreamSubscriber>;
    completed: boolean;
    abortController: AbortController;
    timeout: NodeJS.Timeout;
    gcTimer?: NodeJS.Timeout;
}

export interface StreamRequestBody {
    message?: string;
    attachments?: MessageAttachment[];
    streamId?: string;
    cursor?: number;
    timeoutMs?: number;
}

export interface BeginStreamOperationParams {
    sessionId: string;
    projectRoot: string;
    message: string;
    attachments?: MessageAttachment[];
    timeoutMs: number;
    runMessageStream: (params: {
        projectRoot: string;
        sessionId: string;
        message: string;
        attachments?: MessageAttachment[];
        onEvent: (event: ConversationEventEnvelope) => void;
        requestQuestion: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
        requestToolApproval: (request: ToolApprovalRequest) => Promise<boolean>;
        signal?: AbortSignal;
    }) => Promise<{ response: string; sessionId: string }>;
}

interface StreamControllerOptions {
    randomId?: (prefix: string) => string;
    defaultStreamTimeoutMs?: number;
    minStreamTimeoutMs?: number;
    maxStreamTimeoutMs?: number;
    questionTimeoutMs?: number;
    streamGcTtlMs?: number;
    onApprovalPending?: (record: {
        sessionId: string;
        streamId: string;
        requestId: string;
        request: ToolApprovalRequest;
        requestedAt: Date;
    }) => void;
    onApprovalResolved?: (record: {
        sessionId: string;
        streamId: string;
        requestId: string;
        decision: 'allow' | 'deny';
        resolvedAt: Date;
    }) => void;
}

interface ResolveQuestionRequestParams {
    sessionId: string;
    requestId: string;
    selected: string[];
    customText?: string;
    streamId?: string;
}

interface ResolveApprovalRequestParams {
    sessionId: string;
    requestId: string;
    decision: 'allow' | 'deny';
    streamId?: string;
}

type ResolveQuestionRequestResult =
    | { ok: true }
    | { ok: false; status: 404 | 409; body: { error: string; sessionId: string; requestId: string } };

type ResolveApprovalRequestResult =
    | { ok: true }
    | { ok: false; status: 404 | 409; body: { error: string; sessionId: string; requestId: string } };

type CancelStreamOperationResult =
    | { ok: true; streamId: string }
    | { ok: false; status: 404; body: { error: string; sessionId: string; streamId: string } };

export interface StreamController {
    addEventSubscriber: (res: http.ServerResponse, corsHeaders: Record<string, string>) => void;
    attachStreamSubscriber: (
        op: StreamOperation,
        res: http.ServerResponse,
        corsHeaders: Record<string, string>,
        cursor: number,
    ) => void;
    beginStreamOperation: (params: BeginStreamOperationParams) => StreamOperation;
    cancelStreamOperation: (sessionId: string, streamId: string) => CancelStreamOperationResult;
    getStreamOperation: (streamId: string) => StreamOperation | undefined;
    parseTimeoutMs: (raw: unknown) => number;
    resolveApprovalRequest: (params: ResolveApprovalRequestParams) => ResolveApprovalRequestResult;
    resolveQuestionRequest: (params: ResolveQuestionRequestParams) => ResolveQuestionRequestResult;
}

function defaultRandomId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function unrefTimer(timer: NodeJS.Timeout): void {
    timer.unref?.();
}

export function isDuplicateStatusEvent(op: StreamOperation, event: ConversationEventEnvelope): boolean {
    if (event.type !== 'status.changed') {
        return false;
    }
    const latest = op.records[op.records.length - 1];
    if (!latest || latest.type !== 'event' || latest.event.type !== 'status.changed') {
        return false;
    }
    return latest.event.sessionId === event.sessionId && latest.event.payload.status === event.payload.status;
}

export function createStreamController(options: StreamControllerOptions = {}): StreamController {
    const pendingApprovals = new Map<string, PendingApprovalEntry>();
    const pendingApprovalsByLegacyKey = new Map<string, Set<string>>();
    const pendingQuestions = new Map<string, PendingQuestionEntry>();
    const pendingQuestionsByLegacyKey = new Map<string, Set<string>>();
    const streamOperations = new Map<string, StreamOperation>();
    const eventSubscribers = new Set<http.ServerResponse>();

    const randomId = options.randomId ?? defaultRandomId;
    const defaultStreamTimeoutMs = options.defaultStreamTimeoutMs ?? 120000;
    const minStreamTimeoutMs = options.minStreamTimeoutMs ?? 5000;
    const maxStreamTimeoutMs = options.maxStreamTimeoutMs ?? 10 * 60 * 1000;
    const questionTimeoutMs = options.questionTimeoutMs ?? 120000;
    const streamGcTtlMs = options.streamGcTtlMs ?? 2 * 60 * 1000;

    function parseTimeoutMs(raw: unknown): number {
        const num = Number(raw);
        if (!Number.isFinite(num)) {
            return defaultStreamTimeoutMs;
        }
        return Math.min(maxStreamTimeoutMs, Math.max(minStreamTimeoutMs, Math.floor(num)));
    }

    function removePendingQuestion(key: string, pending: PendingQuestionEntry): void {
        pendingQuestions.delete(key);
        clearTimeout(pending.timeout);

        const legacyKey = `${pending.sessionId}:${pending.requestId}`;
        const index = pendingQuestionsByLegacyKey.get(legacyKey);
        if (!index) {
            return;
        }
        index.delete(key);
        if (index.size === 0) {
            pendingQuestionsByLegacyKey.delete(legacyKey);
        }
    }

    function removePendingApproval(key: string, pending: PendingApprovalEntry): void {
        pendingApprovals.delete(key);
        clearTimeout(pending.timeout);

        const legacyKey = `${pending.sessionId}:${pending.requestId}`;
        const index = pendingApprovalsByLegacyKey.get(legacyKey);
        if (!index) {
            return;
        }
        index.delete(key);
        if (index.size === 0) {
            pendingApprovalsByLegacyKey.delete(legacyKey);
        }
    }

    function closeSubscriber(op: StreamOperation, subscriberId: string): void {
        const subscriber = op.subscribers.get(subscriberId);
        if (!subscriber) {
            return;
        }
        op.subscribers.delete(subscriberId);
        try {
            if (!subscriber.res.writableEnded) {
                subscriber.res.end();
            }
        } catch {
            // ignore socket write failures
        }
    }

    function finalizeOperation(op: StreamOperation): void {
        if (op.gcTimer) {
            clearTimeout(op.gcTimer);
        }
        op.gcTimer = setTimeout(() => {
            streamOperations.delete(op.id);
        }, streamGcTtlMs);
        unrefTimer(op.gcTimer);
    }

    function appendRecord(op: StreamOperation, record: StreamAppendRecord): StreamWireRecord {
        const seq = op.nextSeq;
        op.nextSeq += 1;

        const wrapped: StreamWireRecord = record.type === 'event'
            ? {
                type: 'event',
                event: record.event,
                streamId: op.id,
                seq,
                cursor: seq,
            }
            : record.type === 'done'
                ? { type: 'done', response: record.response, sessionId: record.sessionId, streamId: op.id, seq, cursor: seq }
                : record.type === 'error'
                    ? { type: 'error', message: record.message, streamId: op.id, seq, cursor: seq }
                    : { type: 'cancelled', reason: record.reason, streamId: op.id, seq, cursor: seq };

        op.records.push(wrapped);

        for (const subscriber of op.subscribers.values()) {
            if (wrapped.seq <= subscriber.lastSeq) {
                continue;
            }
            try {
                subscriber.res.write(`${JSON.stringify(wrapped)}\n`);
                subscriber.lastSeq = wrapped.seq;
                if (wrapped.type === 'done' || wrapped.type === 'error' || wrapped.type === 'cancelled') {
                    closeSubscriber(op, subscriber.id);
                }
            } catch {
                closeSubscriber(op, subscriber.id);
            }
        }

        return wrapped;
    }

    function addEventSubscriber(
        res: http.ServerResponse,
        corsHeaders: Record<string, string>,
    ): void {
        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        eventSubscribers.add(res);

        const release = () => {
            eventSubscribers.delete(res);
        };
        res.once('close', release);
        res.once('error', release);
    }

    function attachStreamSubscriber(
        op: StreamOperation,
        res: http.ServerResponse,
        corsHeaders: Record<string, string>,
        cursor: number,
    ): void {
        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        let lastSeq = Math.max(0, Math.floor(cursor));
        for (const record of op.records) {
            if (record.seq <= lastSeq) {
                continue;
            }
            res.write(`${JSON.stringify(record)}\n`);
            lastSeq = record.seq;
        }

        if (op.completed) {
            res.end();
            return;
        }

        const subscriberId = randomId('sub');
        op.subscribers.set(subscriberId, {
            id: subscriberId,
            res,
            lastSeq,
        });

        const release = () => {
            op.subscribers.delete(subscriberId);
        };
        res.once('close', release);
        res.once('error', release);
    }

    function publishEvent(event: ConversationEventEnvelope): void {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        for (const subscriber of eventSubscribers) {
            try {
                subscriber.write(payload);
            } catch {
                eventSubscribers.delete(subscriber);
            }
        }
    }

    function waitForQuestionAnswer(
        sessionId: string,
        streamId: string,
        prompt: QuestionPrompt,
    ): Promise<QuestionAnswer> {
        const key = `${streamId}:${prompt.requestId}`;
        const legacyKey = `${sessionId}:${prompt.requestId}`;

        return new Promise<QuestionAnswer>((resolve) => {
            const timeout = setTimeout(() => {
                const pending = pendingQuestions.get(key);
                if (!pending) {
                    return;
                }
                removePendingQuestion(key, pending);
                resolve({
                    requestId: prompt.requestId,
                    selected: pending.fallbackSelected,
                });
            }, questionTimeoutMs);
            unrefTimer(timeout);

            const pending: PendingQuestionEntry = {
                sessionId,
                streamId,
                requestId: prompt.requestId,
                fallbackSelected: prompt.options.length > 0 ? [prompt.options[0]!.label] : [],
                resolve: (answer) => {
                    clearTimeout(timeout);
                    resolve(answer);
                },
                timeout,
            };

            pendingQuestions.set(key, pending);
            const index = pendingQuestionsByLegacyKey.get(legacyKey);
            if (index) {
                index.add(key);
                return;
            }
            pendingQuestionsByLegacyKey.set(legacyKey, new Set([key]));
        });
    }

    function resolvePendingQuestionsForStream(streamId: string): void {
        for (const [key, pending] of pendingQuestions.entries()) {
            if (pending.streamId !== streamId) {
                continue;
            }
            removePendingQuestion(key, pending);
            pending.resolve({
                requestId: pending.requestId,
                selected: pending.fallbackSelected,
            });
        }
    }

    function waitForToolApproval(
        sessionId: string,
        streamId: string,
        request: ToolApprovalRequest,
    ): Promise<boolean> {
        const requestId = typeof request.toolCallId === 'string' && request.toolCallId.trim().length > 0
            ? request.toolCallId.trim()
            : 'unknown-tool-call';
        const key = `${streamId}:${requestId}`;
        const legacyKey = `${sessionId}:${requestId}`;

        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                const pending = pendingApprovals.get(key);
                if (!pending) {
                    return;
                }
                removePendingApproval(key, pending);
                options.onApprovalResolved?.({
                    sessionId: pending.sessionId,
                    streamId: pending.streamId,
                    requestId: pending.requestId,
                    decision: pending.fallbackDecision,
                    resolvedAt: new Date(),
                });
                resolve(pending.fallbackDecision === 'allow');
            }, questionTimeoutMs);
            unrefTimer(timeout);

            const pending: PendingApprovalEntry = {
                sessionId,
                streamId,
                requestId,
                fallbackDecision: 'deny',
                resolve: (approved) => {
                    clearTimeout(timeout);
                    resolve(approved);
                },
                timeout,
            };

            pendingApprovals.set(key, pending);
            options.onApprovalPending?.({
                sessionId,
                streamId,
                requestId,
                request,
                requestedAt: new Date(),
            });
            const index = pendingApprovalsByLegacyKey.get(legacyKey);
            if (index) {
                index.add(key);
                return;
            }
            pendingApprovalsByLegacyKey.set(legacyKey, new Set([key]));
        });
    }

    function resolvePendingApprovalsForStream(streamId: string): void {
        for (const [key, pending] of pendingApprovals.entries()) {
            if (pending.streamId !== streamId) {
                continue;
            }
            removePendingApproval(key, pending);
            options.onApprovalResolved?.({
                sessionId: pending.sessionId,
                streamId: pending.streamId,
                requestId: pending.requestId,
                decision: pending.fallbackDecision,
                resolvedAt: new Date(),
            });
            pending.resolve(pending.fallbackDecision === 'allow');
        }
    }

    function beginStreamOperation(params: BeginStreamOperationParams): StreamOperation {
        const op: StreamOperation = {
            id: randomId('stream'),
            sessionId: params.sessionId,
            projectRoot: params.projectRoot,
            message: params.message,
            ...(params.attachments ? { attachments: params.attachments } : {}),
            createdAt: Date.now(),
            nextSeq: 1,
            records: [],
            subscribers: new Map(),
            completed: false,
            abortController: new AbortController(),
            timeout: setTimeout(() => {
                if (!op.abortController.signal.aborted) {
                    op.abortController.abort(new Error(`Stream timeout (${params.timeoutMs}ms)`));
                }
            }, params.timeoutMs),
        };
        unrefTimer(op.timeout);
        streamOperations.set(op.id, op);

        void params.runMessageStream({
            projectRoot: params.projectRoot,
            sessionId: params.sessionId,
            message: params.message,
            ...(params.attachments ? { attachments: params.attachments } : {}),
            signal: op.abortController.signal,
            onEvent: (event) => {
                if (isDuplicateStatusEvent(op, event)) {
                    return;
                }
                publishEvent(event);
                appendRecord(op, { type: 'event', event });
            },
            requestQuestion: (prompt) => waitForQuestionAnswer(params.sessionId, op.id, prompt),
            requestToolApproval: (request) => waitForToolApproval(params.sessionId, op.id, request),
        }).then((result) => {
            op.completed = true;
            appendRecord(op, {
                type: 'done',
                response: result.response,
                sessionId: result.sessionId,
            });
            clearTimeout(op.timeout);
            finalizeOperation(op);
        }).catch((err) => {
            op.completed = true;
            const aborted = op.abortController.signal.aborted;
            if (aborted) {
                resolvePendingApprovalsForStream(op.id);
                resolvePendingQuestionsForStream(op.id);
                const reason = op.abortController.signal.reason;
                appendRecord(op, {
                    type: 'cancelled',
                    reason: reason instanceof Error ? reason.message : 'Cancelled',
                });
            } else {
                appendRecord(op, {
                    type: 'error',
                    message: err instanceof Error ? err.message : String(err),
                });
            }
            clearTimeout(op.timeout);
            finalizeOperation(op);
        });

        return op;
    }

    function cancelStreamOperation(
        sessionId: string,
        streamId: string,
    ): CancelStreamOperationResult {
        const op = streamOperations.get(streamId);
        if (!op || op.sessionId !== sessionId) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Stream not found',
                    sessionId,
                    streamId,
                },
            };
        }

        if (!op.abortController.signal.aborted) {
            op.abortController.abort(new Error('Cancelled by client'));
        }
        resolvePendingApprovalsForStream(op.id);
        resolvePendingQuestionsForStream(op.id);
        return { ok: true, streamId };
    }

    function getStreamOperation(streamId: string): StreamOperation | undefined {
        return streamOperations.get(streamId);
    }

    function resolveApprovalRequest(
        params: ResolveApprovalRequestParams,
    ): ResolveApprovalRequestResult {
        const trimmedStreamId = typeof params.streamId === 'string' && params.streamId.trim().length > 0
            ? params.streamId.trim()
            : undefined;
        const candidates = trimmedStreamId
            ? [`${trimmedStreamId}:${params.requestId}`]
            : Array.from(pendingApprovalsByLegacyKey.get(`${params.sessionId}:${params.requestId}`) ?? []);

        if (candidates.length === 0) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Approval request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        if (candidates.length > 1) {
            return {
                ok: false,
                status: 409,
                body: {
                    error: 'Multiple pending approval requests; specify streamId',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        const key = candidates[0]!;
        const pending = pendingApprovals.get(key);
        if (!pending) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Approval request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }
        if (pending.sessionId !== params.sessionId) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Approval request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        removePendingApproval(key, pending);
        options.onApprovalResolved?.({
            sessionId: pending.sessionId,
            streamId: pending.streamId,
            requestId: pending.requestId,
            decision: params.decision,
            resolvedAt: new Date(),
        });
        pending.resolve(params.decision === 'allow');
        return { ok: true };
    }

    function resolveQuestionRequest(
        params: ResolveQuestionRequestParams,
    ): ResolveQuestionRequestResult {
        const trimmedStreamId = typeof params.streamId === 'string' && params.streamId.trim().length > 0
            ? params.streamId.trim()
            : undefined;
        const candidates = trimmedStreamId
            ? [`${trimmedStreamId}:${params.requestId}`]
            : Array.from(pendingQuestionsByLegacyKey.get(`${params.sessionId}:${params.requestId}`) ?? []);

        if (candidates.length === 0) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Question request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        if (candidates.length > 1) {
            return {
                ok: false,
                status: 409,
                body: {
                    error: 'Multiple pending question requests; specify streamId',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        const key = candidates[0]!;
        const pending = pendingQuestions.get(key);
        if (!pending) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Question request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }
        if (pending.sessionId !== params.sessionId) {
            return {
                ok: false,
                status: 404,
                body: {
                    error: 'Question request not found',
                    sessionId: params.sessionId,
                    requestId: params.requestId,
                },
            };
        }

        const answer: QuestionAnswer = {
            requestId: params.requestId,
            selected: params.selected.filter((entry): entry is string => typeof entry === 'string'),
            ...(typeof params.customText === 'string' && params.customText.trim().length > 0
                ? { customText: params.customText.trim() }
                : {}),
        };

        removePendingQuestion(key, pending);
        pending.resolve(answer);
        return { ok: true };
    }

    return {
        addEventSubscriber,
        attachStreamSubscriber,
        beginStreamOperation,
        cancelStreamOperation,
        getStreamOperation,
        parseTimeoutMs,
        resolveApprovalRequest,
        resolveQuestionRequest,
    };
}
