import * as http from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import type { AgentSessionStore, PersistedSessionSummary } from '@xqoder/agent';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import type { MessageAttachment } from '@xqoder/shared';
import type { ToolApprovalRequest } from '../../domain/permissions/index.js';
import { buildProjectedConversationTranscript } from '../../domain/conversation/index.js';
import { selectConversationTranscriptProjectionSources } from '../../domain/conversation/index.js';
import {
    jsonResponse,
    readBody,
} from './server-helpers.js';
import type {
    StreamController,
    StreamOperation,
    StreamRequestBody,
} from './server-stream.js';

type ReadBody = (req: http.IncomingMessage) => Promise<string>;

type RunMessage = (params: {
    projectRoot: string;
    sessionId: string;
    message: string;
    attachments?: MessageAttachment[];
}) => Promise<{ response: string; sessionId: string }>;

type RunMessageStream = (params: {
    projectRoot: string;
    sessionId: string;
    message: string;
    attachments?: MessageAttachment[];
    onEvent: (event: ConversationEventEnvelope) => void;
    requestQuestion: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
    requestToolApproval: (request: ToolApprovalRequest) => Promise<boolean>;
    signal?: AbortSignal;
}) => Promise<{ response: string; sessionId: string }>;

export interface SessionRouteParams {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    pathParts: string[];
    parsed: UrlWithParsedQuery;
    cwd: string;
    defaultModel: string;
    store?: AgentSessionStore;
    corsHeaders: Record<string, string>;
    readBodyImpl?: ReadBody;
}

export interface MessageRouteParams {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    pathParts: string[];
    store?: AgentSessionStore;
    runMessage?: RunMessage;
    runMessageStream?: RunMessageStream;
    streamController: StreamController;
    corsHeaders: Record<string, string>;
    readBodyImpl?: ReadBody;
}

interface ReadJsonSuccess<T> {
    ok: true;
    body: T;
}

interface ReadJsonFailure {
    ok: false;
    error: string;
}

function toSessionPayload(
    summary: PersistedSessionSummary,
    options: {
        includeUsage?: boolean;
    } = {},
): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        id: summary.id,
        projectRoot: summary.projectRoot,
        cwd: summary.cwd,
        model: summary.model,
        title: summary.title,
        createdAt: summary.createdAt.toISOString(),
        updatedAt: summary.updatedAt.toISOString(),
        messageCount: summary.messageCount,
    };

    if (options.includeUsage) {
        payload.usage = summary.usage;
    }

    return payload;
}

function toConversationSignalsPayload(
    session: NonNullable<ReturnType<AgentSessionStore['getSession']>>,
): ReturnType<typeof buildProjectedConversationTranscript> {
    const conversationEventEnvelopes = Array.isArray(session.getConversationEventEnvelopes?.())
        ? session.getConversationEventEnvelopes!() as ConversationEventEnvelope[]
        : undefined;
    return buildProjectedConversationTranscript({
        messages: session.getMessages().map((message) => ({
            role: message.role,
            content: String(message.content ?? ''),
            ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        })),
        toolHistory: session.getToolHistory().map((entry) => ({
            id: entry.id,
            name: entry.name,
            success: entry.success,
        })),
        verificationHistory: session.getVerificationHistory().map((entry) => ({
            id: entry.id,
            ok: entry.ok,
            blocked: entry.blocked,
            summary: entry.summary,
            messages: entry.messages,
        })),
        ...selectConversationTranscriptProjectionSources({
            ...(conversationEventEnvelopes ? { conversationEventEnvelopes } : {}),
            conversationEvents: session.getConversationEvents(),
        }),
    });
}

function toSessionDetailPayload(
    summary: PersistedSessionSummary,
    session: NonNullable<ReturnType<AgentSessionStore['getSession']>>,
): Record<string, unknown> {
    return {
        ...toSessionPayload(summary, { includeUsage: true }),
        transcript: session.getMessages(),
        conversationSignals: toConversationSignalsPayload(session),
        pendingApprovals: session.getPendingApprovals?.() ?? [],
        approvalHistory: session.getApprovalHistory?.() ?? [],
    };
}

async function readJsonBody<T>(
    req: http.IncomingMessage,
    readBodyImpl: ReadBody,
): Promise<ReadJsonSuccess<T> | ReadJsonFailure> {
    try {
        const raw = await readBodyImpl(req);
        return {
            ok: true,
            body: (raw ? JSON.parse(raw) : {}) as T,
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Invalid JSON body',
        };
    }
}

function resolveStreamOperation(
    streamController: StreamController,
    sessionId: string,
    requestedStreamId: string | undefined,
): StreamOperation | undefined {
    if (!requestedStreamId) {
        return undefined;
    }
    const operation = streamController.getStreamOperation(requestedStreamId);
    if (!operation || operation.sessionId !== sessionId) {
        return undefined;
    }
    return operation;
}

export async function handleSessionRoutes(params: SessionRouteParams): Promise<boolean> {
    const {
        req,
        res,
        pathParts,
        parsed,
        cwd,
        defaultModel,
        store,
        corsHeaders,
        readBodyImpl = readBody,
    } = params;

    if (pathParts[0] !== 'session') {
        return false;
    }

    if (pathParts.length === 1 && req.method === 'GET') {
        if (!store) {
            jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
            return true;
        }

        const projectRoot = (parsed.query?.projectRoot as string) || cwd;
        const limit = Math.min(100, Math.max(1, Number(parsed.query?.limit) || 20));
        const summaries = store.listSessions(projectRoot, limit);
        jsonResponse(res, 200, summaries.map((summary) => toSessionPayload(summary, { includeUsage: true })), corsHeaders);
        return true;
    }

    if (pathParts.length === 1 && req.method === 'POST') {
        if (!store) {
            jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
            return true;
        }

        const parsedBody = await readJsonBody<{ projectRoot?: string; title?: string }>(req, readBodyImpl);
        if ('error' in parsedBody) {
            jsonResponse(res, 400, { error: parsedBody.error }, corsHeaders);
            return true;
        }

        const projectRoot = parsedBody.body.projectRoot ? String(parsedBody.body.projectRoot) : cwd;
        const title = parsedBody.body.title != null ? String(parsedBody.body.title) : undefined;
        const summary = store.createEmptySession(projectRoot, defaultModel, title);
        jsonResponse(res, 200, toSessionPayload(summary), corsHeaders);
        return true;
    }

    if (pathParts.length === 2 && pathParts[1] && req.method === 'GET') {
        if (!store) {
            jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
            return true;
        }

        const sessionId = pathParts[1];
        const summary = store.getSessionSummary(sessionId);
        if (!summary) {
            jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
            return true;
        }

        const session = store.getSession(sessionId);
        if (!session) {
            jsonResponse(res, 200, toSessionPayload(summary, { includeUsage: true }), corsHeaders);
            return true;
        }

        jsonResponse(res, 200, toSessionDetailPayload(summary, session), corsHeaders);
        return true;
    }

    if (pathParts.length === 3 && pathParts[1] && pathParts[2] === 'messages' && req.method === 'GET') {
        if (!store) {
            jsonResponse(res, 503, { error: 'Session store not configured' }, corsHeaders);
            return true;
        }

        const sessionId = pathParts[1];
        const session = store.getSession(sessionId);
        if (!session) {
            jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
            return true;
        }

        jsonResponse(res, 200, {
            messages: session.getMessages(),
            conversationSignals: toConversationSignalsPayload(session),
        }, corsHeaders);
        return true;
    }

    return false;
}

export async function handleMessageRoutes(params: MessageRouteParams): Promise<boolean> {
    const {
        req,
        res,
        pathParts,
        store,
        runMessage,
        runMessageStream,
        streamController,
        corsHeaders,
        readBodyImpl = readBody,
    } = params;

    if (pathParts[0] !== 'session') {
        return false;
    }

    if (
        pathParts.length === 5
        && pathParts[1]
        && pathParts[2] === 'stream'
        && pathParts[3]
        && pathParts[4] === 'cancel'
        && req.method === 'POST'
    ) {
        const sessionId = pathParts[1];
        const streamId = pathParts[3];
        const result = streamController.cancelStreamOperation(sessionId, streamId);
        if ('status' in result) {
            jsonResponse(res, result.status, result.body, corsHeaders);
            return true;
        }

        jsonResponse(res, 200, { ok: true, streamId: result.streamId }, corsHeaders);
        return true;
    }

    if (
        pathParts.length === 5
        && pathParts[1]
        && pathParts[2] === 'approval'
        && pathParts[3]
        && pathParts[4] === 'resolve'
        && req.method === 'POST'
    ) {
        const sessionId = pathParts[1];
        const requestId = pathParts[3];
        const parsedBody = await readJsonBody<{ decision?: string; streamId?: string }>(req, readBodyImpl);
        if ('error' in parsedBody) {
            jsonResponse(res, 400, { error: parsedBody.error }, corsHeaders);
            return true;
        }

        const decision = typeof parsedBody.body.decision === 'string'
            ? parsedBody.body.decision.trim().toLowerCase()
            : '';
        if (decision !== 'allow' && decision !== 'deny') {
            jsonResponse(res, 400, { error: 'Missing or invalid approval decision' }, corsHeaders);
            return true;
        }

        const result = streamController.resolveApprovalRequest({
            sessionId,
            requestId,
            decision,
            ...(parsedBody.body.streamId ? { streamId: parsedBody.body.streamId } : {}),
        });
        if ('status' in result) {
            jsonResponse(res, result.status, result.body, corsHeaders);
            return true;
        }

        jsonResponse(res, 200, { ok: true, requestId }, corsHeaders);
        return true;
    }

    if (
        pathParts.length === 5
        && pathParts[1]
        && pathParts[2] === 'question'
        && pathParts[3]
        && pathParts[4] === 'resolve'
        && req.method === 'POST'
    ) {
        const sessionId = pathParts[1];
        const requestId = pathParts[3];
        const parsedBody = await readJsonBody<{ selected?: string[]; customText?: string; streamId?: string }>(req, readBodyImpl);
        if ('error' in parsedBody) {
            jsonResponse(res, 400, { error: parsedBody.error }, corsHeaders);
            return true;
        }

        const selected = Array.isArray(parsedBody.body.selected)
            ? parsedBody.body.selected.filter((entry): entry is string => typeof entry === 'string')
            : [];
        const result = streamController.resolveQuestionRequest({
            sessionId,
            requestId,
            selected,
            ...(parsedBody.body.customText ? { customText: parsedBody.body.customText } : {}),
            ...(parsedBody.body.streamId ? { streamId: parsedBody.body.streamId } : {}),
        });
        if ('status' in result) {
            jsonResponse(res, result.status, result.body, corsHeaders);
            return true;
        }

        jsonResponse(res, 200, { ok: true, requestId }, corsHeaders);
        return true;
    }

    if (pathParts.length === 3 && pathParts[1] && pathParts[2] === 'message' && req.method === 'POST') {
        if (!runMessage || !store) {
            jsonResponse(res, 503, { error: 'Server not configured for messages' }, corsHeaders);
            return true;
        }

        const sessionId = pathParts[1];
        const summary = store.getSessionSummary(sessionId);
        if (!summary) {
            jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
            return true;
        }

        const parsedBody = await readJsonBody<{ message?: string; attachments?: MessageAttachment[] }>(req, readBodyImpl);
        if ('error' in parsedBody) {
            jsonResponse(res, 400, { error: parsedBody.error }, corsHeaders);
            return true;
        }

        const message = parsedBody.body.message != null ? String(parsedBody.body.message) : '';
        if (!message.trim()) {
            jsonResponse(res, 400, { error: 'Missing or empty message' }, corsHeaders);
            return true;
        }

        try {
            const result = await runMessage({
                projectRoot: summary.projectRoot,
                sessionId,
                message: message.trim(),
                ...(parsedBody.body.attachments ? { attachments: parsedBody.body.attachments } : {}),
            });
            jsonResponse(res, 200, { response: result.response, sessionId: result.sessionId }, corsHeaders);
        } catch (error) {
            jsonResponse(res, 500, { error: error instanceof Error ? error.message : String(error) }, corsHeaders);
        }
        return true;
    }

    if (
        pathParts.length === 4
        && pathParts[1]
        && pathParts[2] === 'message'
        && pathParts[3] === 'stream'
        && req.method === 'POST'
    ) {
        if (!runMessageStream || !store) {
            jsonResponse(res, 503, { error: 'Server not configured for message streaming' }, corsHeaders);
            return true;
        }

        const sessionId = pathParts[1];
        const summary = store.getSessionSummary(sessionId);
        if (!summary) {
            jsonResponse(res, 404, { error: 'Session not found', id: sessionId }, corsHeaders);
            return true;
        }

        const parsedBody = await readJsonBody<StreamRequestBody>(req, readBodyImpl);
        if ('error' in parsedBody) {
            jsonResponse(res, 400, { error: parsedBody.error }, corsHeaders);
            return true;
        }

        const body = parsedBody.body;
        const cursor = Number.isFinite(Number(body.cursor)) ? Math.max(0, Math.floor(Number(body.cursor))) : 0;
        const requestedStreamId = typeof body.streamId === 'string' && body.streamId.trim().length > 0
            ? body.streamId.trim()
            : undefined;

        const existingOperation = resolveStreamOperation(streamController, sessionId, requestedStreamId);
        const operation = (() => {
            if (requestedStreamId) {
                return existingOperation;
            }

            const message = body.message != null ? String(body.message) : '';
            if (!message.trim()) {
                jsonResponse(res, 400, { error: 'Missing or empty message' }, corsHeaders);
                return null;
            }

            return streamController.beginStreamOperation({
                sessionId,
                projectRoot: summary.projectRoot,
                message: message.trim(),
                ...(body.attachments ? { attachments: body.attachments } : {}),
                timeoutMs: streamController.parseTimeoutMs(body.timeoutMs),
                runMessageStream,
            });
        })();

        if (requestedStreamId && !operation) {
            jsonResponse(res, 404, { error: 'Stream not found', sessionId, streamId: requestedStreamId }, corsHeaders);
            return true;
        }

        if (!operation) {
            return true;
        }

        streamController.attachStreamSubscriber(operation, res, corsHeaders, cursor);
        return true;
    }

    return false;
}
