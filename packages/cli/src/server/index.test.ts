import { afterEach, describe, expect, it } from 'vitest';
import type * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from './index.js';
import type { AppEvent } from '@xqoder/protocol';

function createSessionStoreMock() {
    return {
        getSessionSummary: (sessionId: string) => {
            if (sessionId !== 's1') return null;
            const now = new Date();
            return {
                id: 's1',
                projectRoot: '/tmp/project',
                cwd: '/tmp/project',
                model: 'openai/gpt-4o',
                title: 'Session 1',
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
            };
        },
    };
}

async function listen(server: http.Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Unexpected server address');
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

describe('serve message stream api', () => {
    const cleanup: Array<() => Promise<void>> = [];

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop();
            if (fn) await fn();
        }
    });

    it('streams ndjson events and done record', async () => {
        const event: AppEvent = {
            type: 'status.changed',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'agent',
            status: 'thinking',
        };
        const server = createServer({
            sessionStore: createSessionStoreMock() as never,
            runMessageStream: async (params) => {
                params.onEvent(event);
                return { response: 'ok', sessionId: 's1' };
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const response = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });

        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain('"type":"event"');
        expect(text).toContain('"seq":1');
        expect(text).toContain('"status":"thinking"');
        expect(text).toContain('"type":"done"');
    });

    it('deduplicates adjacent repeated status.changed events in stream output', async () => {
        const baseEvent: AppEvent = {
            type: 'status.changed',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'agent',
            status: 'thinking',
        };
        const server = createServer({
            sessionStore: createSessionStoreMock() as never,
            runMessageStream: async (params) => {
                params.onEvent(baseEvent);
                params.onEvent({ ...baseEvent, timestamp: Date.now() + 1 });
                return { response: 'ok', sessionId: 's1' };
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const response = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });

        const text = await response.text();
        const lines = text.trim().split('\n').map((line) => JSON.parse(line) as { type: string; event?: AppEvent });
        const statusEvents = lines.filter((record) => record.type === 'event' && record.event?.type === 'status.changed');
        expect(statusEvents).toHaveLength(1);
    });

    it('accepts question resolve while stream is pending', async () => {
        const server = createServer({
            sessionStore: createSessionStoreMock() as never,
            runMessageStream: async (params) => {
                params.onEvent({
                    type: 'question.requested',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: 'q-1',
                    question: 'Pick one',
                    options: [{ label: 'A' }, { label: 'B' }],
                });

                const answer = await params.requestQuestion({
                    requestId: 'q-1',
                    question: 'Pick one',
                    options: [{ label: 'A' }, { label: 'B' }],
                });

                params.onEvent({
                    type: 'question.resolved',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: 'q-1',
                    selected: answer.selected,
                    answerSource: 'ui',
                });

                return { response: answer.selected.join(','), sessionId: 's1' };
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const streamRes = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });
        expect(streamRes.status).toBe(200);
        expect(streamRes.body).toBeTruthy();

        const reader = streamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawResolved = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const raw = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!raw) continue;
                const record = JSON.parse(raw) as { type: string; event?: AppEvent };

                if (record.type === 'event' && record.event?.type === 'question.requested') {
                    const resolveRes = await fetch(`${baseUrl}/session/s1/question/q-1/resolve`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ selected: ['B'] }),
                    });
                    expect(resolveRes.status).toBe(200);
                }

                if (record.type === 'event' && record.event?.type === 'question.resolved') {
                    sawResolved = true;
                    expect(record.event.selected).toEqual(['B']);
                }
            }
        }

        expect(sawResolved).toBe(true);
    });

    it('supports resume with streamId and cursor', async () => {
        const server = createServer({
            sessionStore: createSessionStoreMock() as never,
            runMessageStream: async (params) => {
                params.onEvent({
                    type: 'status.changed',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'thinking',
                });
                await new Promise((resolve) => setTimeout(resolve, 80));
                params.onEvent({
                    type: 'status.changed',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'running-tool',
                });
                return { response: 'ok', sessionId: 's1' };
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const first = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });
        expect(first.status).toBe(200);
        const firstText = await first.text();
        const firstLines = firstText.trim().split('\n').map((line) => JSON.parse(line) as { type: string; seq: number; streamId: string });
        const firstEvent = firstLines.find((line) => line.type === 'event');
        expect(firstEvent).toBeTruthy();

        const resumed = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamId: firstEvent!.streamId, cursor: firstEvent!.seq }),
        });
        expect(resumed.status).toBe(200);
        const resumedText = await resumed.text();
        const resumedLines = resumedText.trim().split('\n').map((line) => JSON.parse(line) as { type: string; seq: number; event?: { status?: string } });
        expect(resumedLines.some((line) => line.type === 'event' && line.event?.status === 'running-tool')).toBe(true);
        expect(resumedLines.some((line) => line.type === 'done')).toBe(true);
    });

    it('supports stream cancel endpoint', async () => {
        const server = createServer({
            sessionStore: createSessionStoreMock() as never,
            runMessageStream: async (params) => {
                params.onEvent({
                    type: 'status.changed',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'thinking',
                });
                while (!params.signal?.aborted) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                throw params.signal.reason instanceof Error ? params.signal.reason : new Error('cancelled');
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const streamRes = await fetch(`${baseUrl}/session/s1/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });
        expect(streamRes.status).toBe(200);
        expect(streamRes.body).toBeTruthy();

        const reader = streamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamId = '';

        while (!streamId) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const raw = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!raw) continue;
                const record = JSON.parse(raw) as { streamId?: string };
                if (typeof record.streamId === 'string' && record.streamId) {
                    streamId = record.streamId;
                    break;
                }
            }
        }

        expect(streamId).toBeTruthy();

        const cancelRes = await fetch(`${baseUrl}/session/s1/stream/${encodeURIComponent(streamId)}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(cancelRes.status).toBe(200);

        let tail = '';
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            tail += decoder.decode(chunk.value, { stream: true });
        }
        expect(tail).toContain('"type":"cancelled"');
    });

    it('exposes project/file/find/provider utility endpoints', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-serve-project-'));
        fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Demo\nalpha beta\n', 'utf-8');
        fs.writeFileSync(path.join(projectRoot, 'src', 'app.ts'), 'export const value = "beta"\n', 'utf-8');
        fs.writeFileSync(path.join(projectRoot, 'src', 'service.ts'), 'export class DemoService {}\nexport function demoRun() {}\n', 'utf-8');

        const server = createServer({
            cwd: projectRoot,
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(async () => {
            await close();
            fs.rmSync(projectRoot, { recursive: true, force: true });
        });

        const projectRes = await fetch(`${baseUrl}/project`);
        expect(projectRes.status).toBe(200);
        const projectData = await projectRes.json() as { projectRoot: string };
        expect(projectData.projectRoot).toBe(projectRoot);

        const fileRes = await fetch(`${baseUrl}/file?path=${encodeURIComponent('README.md')}`);
        expect(fileRes.status).toBe(200);
        const fileData = await fileRes.json() as { content: string };
        expect(fileData.content).toContain('alpha beta');

        const findFileRes = await fetch(`${baseUrl}/find/file?query=${encodeURIComponent('app.ts')}`);
        expect(findFileRes.status).toBe(200);
        const findFileData = await findFileRes.json() as { files: string[] };
        expect(findFileData.files).toContain('src/app.ts');

        const findRes = await fetch(`${baseUrl}/find?query=${encodeURIComponent('beta')}`);
        expect(findRes.status).toBe(200);
        const findData = await findRes.json() as { matches: Array<{ path: string }> };
        expect(findData.matches.some((entry) => entry.path === 'README.md' || entry.path === 'src/app.ts')).toBe(true);

        const symbolRes = await fetch(`${baseUrl}/find/symbol?query=${encodeURIComponent('Demo')}&limit=1`);
        expect(symbolRes.status).toBe(200);
        const symbolData = await symbolRes.json() as {
            strategy?: { lspAttempted: boolean; lspSucceeded: boolean; fallbackScan: boolean };
            pagination?: { cursor: string; nextCursor?: string; total: number };
            symbols: Array<{ name: string; path: string; kind: string }>;
        };
        expect(symbolData.strategy?.fallbackScan).toBe(true);
        expect(symbolData.pagination?.total).toBeGreaterThan(0);
        expect(symbolData.pagination?.cursor).toBe('');
        expect(symbolData.symbols.length).toBe(1);
        expect(symbolData.symbols).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'DemoService',
                kind: 'class',
                path: 'src/service.ts',
            }),
        ]));

        if (symbolData.pagination?.nextCursor) {
            const symbolNextRes = await fetch(`${baseUrl}/find/symbol?query=${encodeURIComponent('Demo')}&limit=1&cursor=${encodeURIComponent(symbolData.pagination.nextCursor)}`);
            expect(symbolNextRes.status).toBe(200);
            const symbolNextData = await symbolNextRes.json() as { pagination?: { cursor: string } };
            expect(symbolNextData.pagination?.cursor).toBe(symbolData.pagination.nextCursor);
        }

        const providerRes = await fetch(`${baseUrl}/provider`);
        expect(providerRes.status).toBe(200);
        const providerData = await providerRes.json() as { providers: unknown[] };
        expect(Array.isArray(providerData.providers)).toBe(true);

        const openApiRes = await fetch(`${baseUrl}/doc.openapi.json`);
        expect(openApiRes.status).toBe(200);
        const openApi = await openApiRes.json() as {
            openapi: string;
            security?: Array<Record<string, string[]>>;
            tags?: Array<{ name: string }>;
            paths: Record<string, unknown>;
            components?: {
                schemas?: Record<string, unknown>;
                securitySchemes?: Record<string, unknown>;
                responses?: Record<string, unknown>;
            };
        };
        expect(openApi.openapi).toBe('3.1.0');
        expect(openApi.paths['/find/symbol']).toBeTruthy();
        expect(openApi.components?.schemas?.['SymbolMatch']).toBeTruthy();
        expect(openApi.components?.schemas?.['SymbolSearchResponse']).toBeTruthy();
        expect(openApi.components?.schemas?.['SessionMessageRequest']).toBeTruthy();
        expect(openApi.components?.schemas?.['StreamRequestBody']).toBeTruthy();
        expect(openApi.components?.schemas?.['SessionMessagesResponse']).toBeTruthy();
        expect(openApi.components?.schemas?.['StreamWireRecord']).toBeTruthy();
        expect(openApi.components?.securitySchemes?.['basicAuth']).toBeTruthy();
        expect(openApi.components?.responses?.['BadRequestError']).toBeTruthy();
        expect(openApi.components?.responses?.['NotFoundError']).toBeTruthy();
        expect(openApi.components?.responses?.['ServiceUnavailableError']).toBeTruthy();
        expect(openApi.components?.responses?.['UnauthorizedError']).toBeTruthy();
        expect(openApi.security).toEqual(expect.arrayContaining([{ basicAuth: [] }]));
        expect(openApi.tags?.some((tag) => tag.name === 'docs')).toBe(true);
        expect(openApi.tags?.some((tag) => tag.name === 'session')).toBe(true);

        const sessionMessagePath = openApi.paths['/session/{id}/message'] as {
            post?: { responses?: Record<string, unknown> };
        };
        expect(sessionMessagePath.post?.responses?.['400']).toBeTruthy();
        expect(sessionMessagePath.post?.responses?.['404']).toBeTruthy();
        expect(sessionMessagePath.post?.responses?.['500']).toBeTruthy();
        expect(sessionMessagePath.post?.responses?.['503']).toBeTruthy();

        const streamPath = openApi.paths['/session/{id}/message/stream'] as {
            post?: {
                requestBody?: { content?: { 'application/json'?: { schema?: { $ref?: string } } } };
                responses?: Record<string, unknown>;
            };
        };
        expect(streamPath.post?.requestBody?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/StreamRequestBody');
        expect(streamPath.post?.responses?.['400']).toBeTruthy();
        expect(streamPath.post?.responses?.['404']).toBeTruthy();
        expect(streamPath.post?.responses?.['503']).toBeTruthy();

        const findPath = openApi.paths['/find'] as {
            get?: {
                operationId?: string;
                tags?: string[];
                responses?: Record<string, { $ref?: string; content?: Record<string, { examples?: Record<string, unknown> }> }>;
            };
        };
        expect(findPath.get?.operationId).toBe('getFindMatches');
        expect(findPath.get?.tags).toEqual(expect.arrayContaining(['search']));
        expect(findPath.get?.responses?.['401']?.$ref).toBe('#/components/responses/UnauthorizedError');
        expect(findPath.get?.responses?.['400']?.$ref).toBe('#/components/responses/BadRequestError');
        expect(findPath.get?.responses?.['200']?.content?.['application/json']?.examples?.['textMatches']).toBeTruthy();

        const filePath = openApi.paths['/file'] as {
            get?: { operationId?: string; responses?: Record<string, { $ref?: string }> };
        };
        expect(filePath.get?.operationId).toBe('getFile');
        expect(filePath.get?.responses?.['400']?.$ref).toBe('#/components/responses/BadRequestError');
        expect(filePath.get?.responses?.['404']?.$ref).toBe('#/components/responses/NotFoundError');

        const sharePath = openApi.paths['/share/{id}'] as {
            get?: { operationId?: string; responses?: Record<string, { $ref?: string }> };
        };
        expect(sharePath.get?.operationId).toBe('getShareById');
        expect(sharePath.get?.responses?.['404']?.$ref).toBe('#/components/responses/NotFoundError');
        expect(sharePath.get?.responses?.['503']?.$ref).toBe('#/components/responses/ServiceUnavailableError');

        const sessionCreatePath = openApi.paths['/session'] as {
            post?: {
                operationId?: string;
                requestBody?: { content?: { 'application/json'?: { examples?: Record<string, unknown> } } };
                responses?: Record<string, { content?: Record<string, { examples?: Record<string, unknown> }> }>;
            };
        };
        expect(sessionCreatePath.post?.operationId).toBe('createSession');
        expect(sessionCreatePath.post?.requestBody?.content?.['application/json']?.examples?.['minimal']).toBeTruthy();
        expect(sessionCreatePath.post?.responses?.['200']?.content?.['application/json']?.examples?.['created']).toBeTruthy();

        const sessionMessagePostPath = openApi.paths['/session/{id}/message'] as {
            post?: {
                operationId?: string;
                requestBody?: { content?: { 'application/json'?: { examples?: Record<string, unknown> } } };
                responses?: Record<string, { content?: Record<string, { examples?: Record<string, unknown> }> }>;
            };
        };
        expect(sessionMessagePostPath.post?.operationId).toBe('postSessionMessage');
        expect(sessionMessagePostPath.post?.requestBody?.content?.['application/json']?.examples?.['textOnly']).toBeTruthy();
        expect(sessionMessagePostPath.post?.responses?.['200']?.content?.['application/json']?.examples?.['reply']).toBeTruthy();

        const docPath = openApi.paths['/doc'] as {
            get?: {
                operationId?: string;
                tags?: string[];
                responses?: Record<string, { content?: Record<string, unknown> }>;
            };
        };
        expect(docPath.get?.operationId).toBe('getDoc');
        expect(docPath.get?.tags).toEqual(expect.arrayContaining(['docs']));
        expect(docPath.get?.responses?.['200']?.content?.['text/html']).toBeTruthy();
        expect(docPath.get?.responses?.['200']?.content?.['application/json']).toBeTruthy();
        const docOpenApiPath = openApi.paths['/doc.openapi.json'] as {
            get?: { responses?: Record<string, { $ref?: string }> };
        };
        expect(docOpenApiPath.get?.responses?.['401']?.$ref).toBe('#/components/responses/UnauthorizedError');

        const eventPath = openApi.paths['/event'] as {
            get?: { tags?: string[]; responses?: Record<string, { content?: Record<string, unknown> }> };
        };
        expect(eventPath.get?.tags).toEqual(expect.arrayContaining(['stream']));
        expect(eventPath.get?.responses?.['200']?.content?.['text/event-stream']).toBeTruthy();

        const docJsonByAcceptRes = await fetch(`${baseUrl}/doc`, {
            headers: { Accept: 'application/json' },
        });
        expect(docJsonByAcceptRes.status).toBe(200);
        const docJson = await docJsonByAcceptRes.json() as { openapi: string };
        expect(docJson.openapi).toBe('3.1.0');
    });

    it('serves share artifacts by id', async () => {
        const server = createServer({
            shareStore: {
                createShare: () => { throw new Error('not used'); },
                listShares: () => [],
                removeShare: () => null,
                getShare: (id: string) => {
                    if (id === 'share_json') {
                        return {
                            id,
                            sessionId: 's1',
                            projectRoot: '/workspace/demo',
                            title: 'Demo JSON',
                            format: 'json' as const,
                            createdAt: new Date('2026-03-14T07:00:00.000Z'),
                            artifactPath: '/tmp/share_json.json',
                            content: JSON.stringify({ hello: 'world' }),
                        };
                    }
                    if (id === 'share_md') {
                        return {
                            id,
                            sessionId: 's1',
                            projectRoot: '/workspace/demo',
                            title: 'Demo Markdown',
                            format: 'markdown' as const,
                            createdAt: new Date('2026-03-14T07:00:00.000Z'),
                            artifactPath: '/tmp/share_md.md',
                            content: '# shared\n',
                        };
                    }
                    return null;
                },
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const jsonRes = await fetch(`${baseUrl}/share/share_json`);
        expect(jsonRes.status).toBe(200);
        const jsonBody = await jsonRes.json() as { hello: string };
        expect(jsonBody.hello).toBe('world');

        const mdRes = await fetch(`${baseUrl}/share/share_md`);
        expect(mdRes.status).toBe(200);
        const mdText = await mdRes.text();
        expect(mdText).toContain('# shared');

        const missingRes = await fetch(`${baseUrl}/share/unknown`);
        expect(missingRes.status).toBe(404);
    });
});
