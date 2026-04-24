import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import { AgentSession } from '../src/core/agent/session/session.js';
import type { MessageAttachment } from '@xqoder/shared';
import { handleMessageRoutes, handleSessionRoutes } from '../src/interfaces/http/server-session.js';

describe('HTTP session routes', () => {
    it('lists sessions with clamped limit and serialized timestamps', async () => {
        const res = new MockServerResponse();
        const createdAt = new Date('2026-04-19T08:00:00.000Z');
        const updatedAt = new Date('2026-04-19T09:00:00.000Z');
        const listCalls: Array<{ projectRoot: string; limit: number }> = [];
        const store = {
            listSessions: (projectRoot?: string, limit?: number) => {
                listCalls.push({ projectRoot: projectRoot ?? '', limit: limit ?? 0 });
                return [{
                    id: 'session-1',
                    projectRoot: '/query-root',
                    cwd: '/query-root',
                    model: 'openai/gpt-4o',
                    title: 'Latest',
                    createdAt,
                    updatedAt,
                    messageCount: 3,
                    usage: {
                        promptTokens: 21,
                        completionTokens: 5,
                        totalTokens: 26,
                        cacheReadTokens: 8,
                        cacheCreationTokens: 3,
                        cost: 0.45,
                    },
                }];
            },
        };

        const handled = await handleSessionRoutes({
            req: { method: 'GET' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session'],
            parsed: { query: { projectRoot: '/query-root', limit: '999' } } as any,
            cwd: '/cwd',
            defaultModel: 'openai/gpt-4o',
            store: store as any,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
        });

        expect(handled).toBe(true);
        expect(listCalls).toEqual([{ projectRoot: '/query-root', limit: 100 }]);
        expect(res.statusCode).toBe(200);
        expect(parseJsonBody(res)).toEqual([{
            id: 'session-1',
            projectRoot: '/query-root',
            cwd: '/query-root',
            model: 'openai/gpt-4o',
            title: 'Latest',
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            messageCount: 3,
            usage: {
                promptTokens: 21,
                completionTokens: 5,
                totalTokens: 26,
                cacheReadTokens: 8,
                cacheCreationTokens: 3,
                cost: 0.45,
            },
        }]);
    });

    it('creates sessions from request bodies and returns serialized summaries', async () => {
        const res = new MockServerResponse();
        const createdAt = new Date('2026-04-19T10:00:00.000Z');
        const updatedAt = new Date('2026-04-19T10:05:00.000Z');
        const createCalls: Array<{ projectRoot: string; model: string; title?: string }> = [];
        const store = {
            createEmptySession: (projectRoot: string, model: string, title?: string) => {
                createCalls.push({ projectRoot, model, title });
                return {
                    id: 'session-2',
                    projectRoot,
                    cwd: projectRoot,
                    model,
                    title,
                    createdAt,
                    updatedAt,
                    messageCount: 0,
                };
            },
        };

        const handled = await handleSessionRoutes({
            req: { method: 'POST' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session'],
            parsed: { query: {} } as any,
            cwd: '/default-project',
            defaultModel: 'anthropic/claude-sonnet-4',
            store: store as any,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            readBodyImpl: async () => JSON.stringify({
                projectRoot: '/body-project',
                title: 'Created Title',
            }),
        });

        expect(handled).toBe(true);
        expect(createCalls).toEqual([{
            projectRoot: '/body-project',
            model: 'anthropic/claude-sonnet-4',
            title: 'Created Title',
        }]);
        expect(parseJsonBody(res)).toEqual({
            id: 'session-2',
            projectRoot: '/body-project',
            cwd: '/body-project',
            model: 'anthropic/claude-sonnet-4',
            title: 'Created Title',
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            messageCount: 0,
        });
    });

    it('returns usage, transcript, and conversation signals in session detail payloads for inspect-style reads', async () => {
        const res = new MockServerResponse();
        const createdAt = new Date('2026-04-19T10:00:00.000Z');
        const updatedAt = new Date('2026-04-19T10:05:00.000Z');
        const session = createInspectableSession();
        const store = {
            getSessionSummary: () => ({
                id: 'session-usage',
                projectRoot: '/body-project',
                cwd: '/body-project',
                model: 'openai/gpt-4.1',
                title: 'Usage Detail',
                createdAt,
                updatedAt,
                messageCount: 2,
                usage: {
                    promptTokens: 34,
                    completionTokens: 8,
                    totalTokens: 42,
                    cacheReadTokens: 13,
                    cacheCreationTokens: 4,
                    cost: 0.19,
                },
            }),
            getSession: () => session,
        };

        const handled = await handleSessionRoutes({
            req: { method: 'GET' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-usage'],
            parsed: { query: {} } as any,
            cwd: '/default-project',
            defaultModel: 'openai/gpt-4.1',
            store: store as any,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toEqual({
            id: 'session-usage',
            projectRoot: '/body-project',
            cwd: '/body-project',
            model: 'openai/gpt-4.1',
            title: 'Usage Detail',
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            messageCount: 2,
            usage: {
                promptTokens: 34,
                completionTokens: 8,
                totalTokens: 42,
                cacheReadTokens: 13,
                cacheCreationTokens: 4,
                cost: 0.19,
            },
            transcript: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'inspect my session' },
                { role: 'tool', content: 'patched http payload', toolCallId: 'tool-http-1' },
                { role: 'system', content: 'Verification passed: inspect payload includes transcript signals' },
                { role: 'assistant', content: 'session detail now exposes transcript and signals' },
            ],
            conversationSignals: [
                { type: 'user', content: 'inspect my session' },
                {
                    type: 'tool',
                    content: 'patched http payload',
                    toolCallId: 'tool-http-1',
                    toolName: 'write_file',
                    success: true,
                },
                {
                    type: 'verification',
                    content: 'Verification passed: inspect payload includes transcript signals',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed: inspect payload includes transcript signals',
                },
                { type: 'assistant', content: 'session detail now exposes transcript and signals' },
            ],
            pendingApprovals: [],
            approvalHistory: [],
        });
    });

    it('prefers persisted envelope replay signals over stale legacy transcript events in session detail payloads', async () => {
        const res = new MockServerResponse();
        const createdAt = new Date('2026-04-19T11:00:00.000Z');
        const updatedAt = new Date('2026-04-19T11:05:00.000Z');
        const session = createEnvelopeReplaySession();
        const store = {
            getSessionSummary: () => ({
                id: 'session-envelope-replay',
                projectRoot: '/body-project',
                cwd: '/body-project',
                model: 'openai/gpt-4.1',
                title: 'Envelope Replay',
                createdAt,
                updatedAt,
                messageCount: 3,
                usage: {
                    promptTokens: 13,
                    completionTokens: 5,
                    totalTokens: 18,
                    cacheReadTokens: 2,
                    cacheCreationTokens: 1,
                    cost: 0.07,
                },
            }),
            getSession: () => session,
        };

        const handled = await handleSessionRoutes({
            req: { method: 'GET' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-envelope-replay'],
            parsed: { query: {} } as any,
            cwd: '/default-project',
            defaultModel: 'openai/gpt-4.1',
            store: store as any,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toMatchObject({
            id: 'session-envelope-replay',
            conversationSignals: [
                { type: 'user', content: 'fresh envelope user' },
                {
                    type: 'tool',
                    content: 'fresh envelope diff preview',
                    toolName: 'preview_diff',
                    success: true,
                },
                {
                    type: 'verification',
                    content: 'Verification passed: envelope replay parity',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed: envelope replay parity',
                },
                { type: 'assistant', content: 'fresh envelope assistant' },
            ],
        });
    });
});

describe('HTTP message routes', () => {
    it('returns transcript messages together with conversation signals for read-style transcript APIs', async () => {
        const res = new MockServerResponse();
        const session = createInspectableSession();
        const store = {
            getSession: () => session,
        };

        const handled = await handleSessionRoutes({
            req: { method: 'GET' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-http-inspect', 'messages'],
            parsed: { query: {} } as any,
            cwd: '/default-project',
            defaultModel: 'openai/gpt-4.1',
            store: store as any,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toEqual({
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'inspect my session' },
                { role: 'tool', content: 'patched http payload', toolCallId: 'tool-http-1' },
                { role: 'system', content: 'Verification passed: inspect payload includes transcript signals' },
                { role: 'assistant', content: 'session detail now exposes transcript and signals' },
            ],
            conversationSignals: [
                { type: 'user', content: 'inspect my session' },
                {
                    type: 'tool',
                    content: 'patched http payload',
                    toolCallId: 'tool-http-1',
                    toolName: 'write_file',
                    success: true,
                },
                {
                    type: 'verification',
                    content: 'Verification passed: inspect payload includes transcript signals',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed: inspect payload includes transcript signals',
                },
                { type: 'assistant', content: 'session detail now exposes transcript and signals' },
            ],
        });
    });

    it('runs direct messages against the resolved session and trims input', async () => {
        const res = new MockServerResponse();
        const attachments: MessageAttachment[] = [{
            type: 'file',
            path: '/tmp/example.txt',
            mimeType: 'text/plain',
        } as MessageAttachment];
        const runCalls: Array<{ projectRoot: string; sessionId: string; message: string; attachments?: MessageAttachment[] }> = [];
        const store = {
            getSessionSummary: () => ({
                id: 'session-1',
                projectRoot: '/project',
            }),
        };
        const runMessage = async (params: { projectRoot: string; sessionId: string; message: string; attachments?: MessageAttachment[] }) => {
            runCalls.push(params);
            return {
                response: 'done',
                sessionId: params.sessionId,
            };
        };

        const handled = await handleMessageRoutes({
            req: { method: 'POST' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-1', 'message'],
            store: store as any,
            runMessage,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            streamController: createStreamControllerStub(),
            readBodyImpl: async () => JSON.stringify({
                message: '  hello world  ',
                attachments,
            }),
        });

        expect(handled).toBe(true);
        expect(runCalls).toEqual([{
            projectRoot: '/project',
            sessionId: 'session-1',
            message: 'hello world',
            attachments,
        }]);
        expect(parseJsonBody(res)).toEqual({
            response: 'done',
            sessionId: 'session-1',
        });
    });

    it('resolves pending approval requests with the active stream id', async () => {
        const res = new MockServerResponse();
        const resolveCalls: Array<Record<string, unknown>> = [];

        const handled = await handleMessageRoutes({
            req: { method: 'POST' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-1', 'approval', 'tool-call-1', 'resolve'],
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            streamController: createStreamControllerStub({
                resolveApprovalRequest: (params: Record<string, unknown>) => {
                    resolveCalls.push(params);
                    return { ok: true };
                },
            }),
            readBodyImpl: async () => JSON.stringify({
                decision: 'allow',
                streamId: 'stream-1',
            }),
        });

        expect(handled).toBe(true);
        expect(resolveCalls).toEqual([{
            sessionId: 'session-1',
            requestId: 'tool-call-1',
            decision: 'allow',
            streamId: 'stream-1',
        }]);
        expect(parseJsonBody(res)).toEqual({
            ok: true,
            requestId: 'tool-call-1',
        });
    });

    it('forwards deny approval resolutions when the client responds without a stream id', async () => {
        const res = new MockServerResponse();
        const resolveCalls: Array<Record<string, unknown>> = [];

        const handled = await handleMessageRoutes({
            req: { method: 'POST' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-1', 'approval', 'tool-call-2', 'resolve'],
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            streamController: createStreamControllerStub({
                resolveApprovalRequest: (params: Record<string, unknown>) => {
                    resolveCalls.push(params);
                    return { ok: true };
                },
            }),
            readBodyImpl: async () => JSON.stringify({
                decision: 'deny',
            }),
        });

        expect(handled).toBe(true);
        expect(resolveCalls).toEqual([{
            sessionId: 'session-1',
            requestId: 'tool-call-2',
            decision: 'deny',
            streamId: undefined,
        }]);
        expect(parseJsonBody(res)).toEqual({
            ok: true,
            requestId: 'tool-call-2',
        });
    });

    it('starts streaming messages through the stream controller for new requests', async () => {
        const res = new MockServerResponse();
        const beginCalls: Array<Record<string, unknown>> = [];
        const attachCalls: Array<Record<string, unknown>> = [];
        const streamController = createStreamControllerStub({
            parseTimeoutMs: (raw) => Number(raw) + 1,
            beginStreamOperation: (params) => {
                beginCalls.push(params as Record<string, unknown>);
                return { id: 'stream-1', sessionId: params.sessionId };
            },
            attachStreamSubscriber: (operation, response, corsHeaders, cursor) => {
                attachCalls.push({
                    operation,
                    response,
                    corsHeaders,
                    cursor,
                });
            },
        });
        const store = {
            getSessionSummary: () => ({
                id: 'session-1',
                projectRoot: '/project',
            }),
        };
        const runMessageStream = async () => ({
            response: 'streamed',
            sessionId: 'session-1',
        });

        const handled = await handleMessageRoutes({
            req: { method: 'POST' } as http.IncomingMessage,
            res: res.asResponse(),
            pathParts: ['session', 'session-1', 'message', 'stream'],
            store: store as any,
            runMessageStream,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            streamController,
            readBodyImpl: async () => JSON.stringify({
                message: '  stream me  ',
                timeoutMs: 41,
                cursor: 2.9,
            }),
        });

        expect(handled).toBe(true);
        expect(beginCalls).toHaveLength(1);
        expect(beginCalls[0]).toMatchObject({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'stream me',
            timeoutMs: 42,
            runMessageStream,
        });
        expect(attachCalls).toEqual([{
            operation: { id: 'stream-1', sessionId: 'session-1' },
            response: res.asResponse(),
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            cursor: 2,
        }]);
    });
});

class MockServerResponse extends EventEmitter {
    public headers: Record<string, string> = {};
    public statusCode = 200;
    public writableEnded = false;
    private readonly chunks: string[] = [];

    get body(): string {
        return this.chunks.join('');
    }

    asResponse(): http.ServerResponse {
        return this as unknown as http.ServerResponse;
    }

    writeHead(statusCode: number, headers: Record<string, string>): this {
        this.statusCode = statusCode;
        this.headers = headers;
        return this;
    }

    write(chunk: string): boolean {
        this.chunks.push(chunk);
        return true;
    }

    end(chunk?: string): this {
        if (typeof chunk === 'string') {
            this.chunks.push(chunk);
        }
        this.writableEnded = true;
        this.emit('close');
        return this;
    }
}

function parseJsonBody(res: MockServerResponse): unknown {
    return JSON.parse(res.body);
}

function createStreamControllerStub(overrides: Record<string, unknown> = {}): any {
    return {
        attachStreamSubscriber: () => undefined,
        beginStreamOperation: (params: { sessionId: string }) => ({
            id: 'stream-default',
            sessionId: params.sessionId,
        }),
        cancelStreamOperation: () => ({ ok: true, streamId: 'stream-default' }),
        getStreamOperation: () => undefined,
        parseTimeoutMs: () => 120000,
        resolveApprovalRequest: () => ({ ok: true }),
        resolveQuestionRequest: () => ({ ok: true }),
        ...overrides,
    };
}

function createInspectableSession(): AgentSession {
    const session = new AgentSession({
        id: 'session-http-inspect',
        title: 'HTTP Inspect',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-19T10:00:00.000Z'),
        maxMessages: 64,
    });
    session.addUserMessage('inspect my session');
    session.recordToolExecution({
        id: 'tool-http-1',
        name: 'write_file',
        args: { path: 'src/interfaces/http/server-session.ts' },
        success: true,
        output: 'patched http payload',
    });
    session.addToolResult('tool-http-1', 'patched http payload');
    session.addMessage({
        role: 'system',
        content: 'Verification passed: inspect payload includes transcript signals',
    });
    session.recordVerification({
        ok: true,
        blocked: false,
        summary: 'Verification passed: inspect payload includes transcript signals',
        messages: ['Verification passed: inspect payload includes transcript signals'],
    });
    session.addAssistantMessage({
        role: 'assistant',
        content: 'session detail now exposes transcript and signals',
    });

    return session;
}

function createEnvelopeReplaySession(): AgentSession {
    const sessionId = 'session-envelope-replay';
    const session = new AgentSession({
        id: sessionId,
        title: 'Envelope Replay',
        systemPrompt: 'system',
        createdAt: new Date('2026-04-19T11:00:00.000Z'),
        maxMessages: 64,
    });
    const eventEmitter = createConversationEventEnvelopeEmitter(
        sessionId,
        `${sessionId}:turn:primary`,
    );

    session.addUserMessage('stale snapshot user');
    session.addAssistantMessage({
        role: 'assistant',
        content: 'stale snapshot assistant',
    });
    session.recordConversationEnvelopeEvent(eventEmitter.emit({
        type: 'message.completed',
        sessionId,
        timestamp: Date.parse('2026-04-19T11:00:00.000Z'),
        source: 'agent',
        message: {
            id: `${sessionId}:user:1`,
            sessionId,
            role: 'user',
            content: 'fresh envelope user',
            createdAt: Date.parse('2026-04-19T11:00:00.000Z'),
        },
    }));
    session.recordConversationEnvelopeEvent(eventEmitter.emit({
        type: 'tool.output',
        sessionId,
        timestamp: Date.parse('2026-04-19T11:00:01.000Z'),
        source: 'tool',
        provider: 'local',
        tool: 'preview_diff',
        output: 'fresh envelope diff preview',
    }));
    session.recordConversationEnvelopeEvent(eventEmitter.emit({
        type: 'tool.completed',
        sessionId,
        timestamp: Date.parse('2026-04-19T11:00:01.100Z'),
        source: 'tool',
        provider: 'local',
        tool: 'preview_diff',
        success: true,
    }));
    session.recordConversationEnvelopeEvent(eventEmitter.emit({
        type: 'verification.completed',
        sessionId,
        timestamp: Date.parse('2026-04-19T11:00:02.000Z'),
        source: 'agent',
        ok: true,
        blocked: false,
        summary: 'Verification passed: envelope replay parity',
    }));
    session.recordConversationEnvelopeEvent(eventEmitter.emit({
        type: 'message.completed',
        sessionId,
        timestamp: Date.parse('2026-04-19T11:00:03.000Z'),
        source: 'agent',
        message: {
            id: `${sessionId}:assistant:1`,
            sessionId,
            role: 'assistant',
            content: 'fresh envelope assistant',
            createdAt: Date.parse('2026-04-19T11:00:03.000Z'),
        },
    }));

    return session;
}
