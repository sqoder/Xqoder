import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
import { handleMetaRoutes } from '../src/interfaces/http/server-meta.js';

describe('HTTP meta routes', () => {
    it('serves /doc as JSON when the client requests application/json', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: { accept: 'application/json' } } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/doc',
            pathParts: ['doc'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            getOpenApiDocument: () => ({ openapi: '3.1.0', info: { title: 'XQoder API' } }),
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(parseJsonBody(res)).toEqual({
            openapi: '3.1.0',
            info: { title: 'XQoder API' },
        });
    });

    it('serves /doc as HTML by default', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/doc',
            pathParts: ['doc'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(res.headers['Content-Type']).toBe('text/html');
        expect(res.body).toContain('/doc.openapi.json');
        expect(res.body).toContain('/global/health');
    });

    it('returns project metadata for /project', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/project',
            pathParts: ['project'],
            cwd: '/workspace/app',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toEqual({
            projectRoot: '/workspace/app',
            cwd: '/workspace/app',
            platform: process.platform,
        });
    });

    it('serves /doc.openapi.json directly', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/doc.openapi.json',
            pathParts: ['doc.openapi.json'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            getOpenApiDocument: () => ({ openapi: '3.1.0', paths: { '/doc': {} } }),
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toEqual({
            openapi: '3.1.0',
            paths: { '/doc': {} },
        });
    });

    it('redacts provider and llm api keys for /config', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/config',
            pathParts: ['config'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(parseJsonBody(res)).toEqual({
            config: {
                providers: {
                    openai: {
                        apiKey: '[redacted]',
                        defaultModel: 'gpt-4o',
                    },
                    anthropic: {
                        apiKey: '',
                        defaultModel: 'claude-sonnet-4',
                    },
                },
                llm: {
                    provider: 'openai',
                    apiKey: '[redacted]',
                },
            },
            appliedEnvVars: ['OPENAI_API_KEY'],
        });
    });

    it('returns provider readiness and current provider for /provider', async () => {
        const res = new MockServerResponse();

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/provider',
            pathParts: ['provider'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        const body = parseJsonBody(res) as {
            current: string;
            providers: Array<{ name: string; current: boolean; authenticated: boolean; disabled: boolean; defaultModel?: string }>;
        };
        expect(body.current).toBe('openai');
        expect(body.providers).toEqual(expect.arrayContaining([
            {
                name: 'openai',
                current: true,
                authenticated: true,
                disabled: false,
                defaultModel: 'gpt-4o',
                baseUrl: undefined,
            },
            {
                name: 'anthropic',
                current: false,
                authenticated: false,
                disabled: false,
                defaultModel: 'claude-sonnet-4',
                baseUrl: undefined,
            },
        ]));
    });

    it('parses JSON shares and falls back when JSON content is malformed', async () => {
        const parsedRes = new MockServerResponse();
        const fallbackRes = new MockServerResponse();
        const createdAt = new Date('2026-04-19T12:00:00.000Z');
        const shareStore = {
            getShare: (id: string) => {
                if (id === 'share-json') {
                    return {
                        id,
                        sessionId: 'session-1',
                        title: 'Parsed',
                        projectRoot: '/project',
                        createdAt,
                        format: 'json' as const,
                        artifactPath: '/tmp/parsed.json',
                        usage: {
                            promptTokens: 21,
                            completionTokens: 5,
                            totalTokens: 26,
                            cacheReadTokens: 8,
                            cacheCreationTokens: 3,
                            cost: 0.45,
                        },
                        content: '{"hello":"world"}',
                    };
                }
                if (id === 'share-bad-json') {
                    return {
                        id,
                        sessionId: 'session-2',
                        title: 'Broken',
                        projectRoot: '/project',
                        createdAt,
                        format: 'json' as const,
                        artifactPath: '/tmp/broken.json',
                        usage: {
                            promptTokens: 11,
                            completionTokens: 2,
                            totalTokens: 13,
                            cacheReadTokens: 4,
                            cacheCreationTokens: 1,
                            cost: 0.12,
                        },
                        content: '{oops',
                    };
                }
                return null;
            },
        };

        const parsedHandled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: parsedRes.asResponse(),
            pathname: '/share/share-json',
            pathParts: ['share', 'share-json'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            shareStore: shareStore as any,
            loadResolvedConfig: () => createResolvedConfig(),
        });
        const fallbackHandled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: fallbackRes.asResponse(),
            pathname: '/share/share-bad-json',
            pathParts: ['share', 'share-bad-json'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            shareStore: shareStore as any,
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(parsedHandled).toBe(true);
        expect(parseJsonBody(parsedRes)).toEqual({ hello: 'world' });
        expect(fallbackHandled).toBe(true);
        expect(parseJsonBody(fallbackRes)).toEqual({
            id: 'share-bad-json',
            sessionId: 'session-2',
            title: 'Broken',
            projectRoot: '/project',
            createdAt: createdAt.toISOString(),
            format: 'json',
            usage: {
                promptTokens: 11,
                completionTokens: 2,
                totalTokens: 13,
                cacheReadTokens: 4,
                cacheCreationTokens: 1,
                cost: 0.12,
            },
            content: '{oops',
        });
    });

    it('serves markdown shares as text/markdown', async () => {
        const res = new MockServerResponse();
        const shareStore = {
            getShare: () => ({
                id: 'share-md',
                sessionId: 'session-1',
                title: 'Notes',
                projectRoot: '/project',
                createdAt: new Date('2026-04-19T13:00:00.000Z'),
                format: 'markdown' as const,
                artifactPath: '/tmp/share.md',
                content: '# hello',
            }),
        };

        const handled = await handleMetaRoutes({
            req: { method: 'GET', headers: {} } as http.IncomingMessage,
            res: res.asResponse(),
            pathname: '/share/share-md',
            pathParts: ['share', 'share-md'],
            cwd: '/project',
            hostname: '127.0.0.1',
            port: 4096,
            corsHeaders: { 'Access-Control-Allow-Origin': '*' },
            shareStore: shareStore as any,
            loadResolvedConfig: () => createResolvedConfig(),
        });

        expect(handled).toBe(true);
        expect(res.headers['Content-Type']).toBe('text/markdown; charset=utf-8');
        expect(res.body).toBe('# hello');
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

function createResolvedConfig() {
    return {
        config: {
            providers: {
                openai: {
                    apiKey: 'sk-test',
                    defaultModel: 'gpt-4o',
                },
                anthropic: {
                    defaultModel: 'claude-sonnet-4',
                },
            },
            llm: {
                provider: 'openai',
                apiKey: 'sk-llm',
            },
        },
        appliedEnvVars: ['OPENAI_API_KEY'],
    };
}
