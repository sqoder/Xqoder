import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
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
});

describe('HTTP message routes', () => {
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
        resolveQuestionRequest: () => ({ ok: true }),
        ...overrides,
    };
}
