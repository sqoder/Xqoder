import { describe, expect, it } from 'bun:test';
import { resolveSessionForExport, resolveSessionForTui } from '../src/application/sessions/session-resolve.js';
import { assertServeDirectoryWritable, resolveServeRuntimeOptions } from '../src/application/remote/serve-runtime.js';
import { runServeCommand, type ServeCommandRuntime } from '../src/commands/remote/serve.js';
import { createDefaultConfig } from '../src/infra/shared/config-defaults.js';

describe('session resolution helpers', () => {
    it('returns the latest session for TUI resume', () => {
        const session = { id: 'session-1' } as any;
        const summary = { id: 'session-1', title: 'Latest Session' } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => summary,
        };

        expect(resolveSessionForTui(store as any, '/project')).toEqual({
            sessionId: 'session-1',
            title: 'Latest Session',
        });
    });

    it('throws when exporting a session without a summary', () => {
        const session = { id: 'session-2' } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => null,
        };

        expect(() => resolveSessionForExport(store as any, undefined, '/project')).toThrow(
            'Unable to read session summary: session-2',
        );
    });

    it('omits the title field when the session summary has no title', () => {
        const session = { id: 'session-3' } as any;
        const summary = { id: 'session-3', title: undefined } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => summary,
        };

        const resolved = resolveSessionForTui(store as any, '/project');

        expect(resolved).toEqual({
            sessionId: 'session-3',
        });
        expect(resolved ? 'title' in resolved : false).toBe(false);
    });
});

describe('serve command helpers', () => {
    it('uses config defaults when CLI overrides are omitted', () => {
        const runtimeOptions = resolveServeRuntimeOptions(
            { dir: '/tmp/project' },
            {
                port: 4123,
                hostname: '0.0.0.0',
                cors: ['https://example.com'],
            },
            {},
        );

        expect(runtimeOptions).toEqual({
            cwd: '/tmp/project',
            port: 4123,
            hostname: '0.0.0.0',
            cors: ['https://example.com'],
            password: undefined,
            username: 'xqoder',
        });
    });

    it('prefers explicit CLI and env overrides', () => {
        const runtimeOptions = resolveServeRuntimeOptions(
            {
                dir: '/tmp/project',
                port: '4999',
                hostname: '127.0.0.2',
                cors: 'https://a.test, https://b.test',
            },
            {
                port: 4123,
                hostname: '0.0.0.0',
                cors: ['https://example.com'],
            },
            {
                XQODER_SERVER_PASSWORD: 'secret',
                XQODER_SERVER_USERNAME: 'alice',
            },
        );

        expect(runtimeOptions).toEqual({
            cwd: '/tmp/project',
            port: 4999,
            hostname: '127.0.0.2',
            cors: ['https://a.test', 'https://b.test'],
            password: 'secret',
            username: 'alice',
        });
    });

    it('rejects missing and read-only serve directories', () => {
        expect(() => assertServeDirectoryWritable('/tmp/project', {
            existsSync: () => false,
        })).toThrow('Project directory does not exist: /tmp/project');

        expect(() => assertServeDirectoryWritable('/tmp/project', {
            existsSync: () => true,
            accessSync: () => {
                throw new Error('readonly');
            },
        })).toThrow('Project directory is not writable, session will not persist: /tmp/project');
    });

    it('starts the real HTTP server with session store and agent callbacks', async () => {
        const loadedConfig = {
            ...createDefaultConfig({}),
            defaultAgent: 'general',
            llm: {
                provider: 'openai' as const,
                model: 'openai/gpt-4o-mini',
                apiKey: '',
            },
            sandbox: {
                mode: 'project' as const,
                allowedPaths: [],
            },
            server: {
                port: 4123,
                hostname: '127.0.0.2',
                cors: ['https://default.test'],
            },
        };
        const outputs: string[] = [];
        const serverOptions: any[] = [];
        const sendCalls: any[] = [];
        let runtime: ServeCommandRuntime | undefined;

        const fakeStore = {
            close: () => {},
        };
        const fakeServer = {
            close: (callback?: () => void) => {
                callback?.();
            },
            on: () => fakeServer,
            once: () => fakeServer,
        };
        const fakeAgentService = {
            cancel: () => {},
            dispose: async () => {},
            sendMessage: async (
                message: string,
                sessionId: string | undefined,
                settings: unknown,
                attachments: unknown[],
                callbacks: any,
            ) => {
                sendCalls.push({
                    message,
                    sessionId,
                    settings,
                    attachments,
                });
                callbacks.onEvent({
                    type: 'message.completed',
                    sessionId: sessionId ?? 'session-new',
                    seq: 1,
                    timestamp: Date.now(),
                    payload: {
                        sessionId: sessionId ?? 'session-new',
                        message: {
                            id: 'message-1',
                            sessionId: sessionId ?? 'session-new',
                            role: 'assistant',
                            content: `reply:${message}`,
                            createdAt: Date.now(),
                        },
                    },
                });
                return {
                    sessionId: sessionId ?? 'session-new',
                };
            },
        };

        runtime = await runServeCommand({
            dir: '/tmp',
            port: '4999',
            host: '127.0.0.9',
            cors: 'https://ui.test',
        }, {
            configLoader: {
                load: () => loadedConfig,
            },
            createAgentService: () => fakeAgentService as any,
            createServer: (options) => {
                serverOptions.push(options);
                return fakeServer as any;
            },
            createSessionStore: () => fakeStore as any,
            env: {
                XQODER_LLM_MODEL: 'openai/gpt-4o-mini',
                XQODER_SERVER_PASSWORD: 'secret',
                XQODER_SERVER_USERNAME: 'alice',
            },
            registerSignalHandlers: false,
            writeOutput: (message) => outputs.push(message),
        });

        expect(runtime.options).toMatchObject({
            cwd: '/tmp',
            port: 4999,
            hostname: '127.0.0.9',
            cors: ['https://ui.test'],
            password: 'secret',
            username: 'alice',
        });
        expect(serverOptions[0]).toMatchObject({
            port: 4999,
            hostname: '127.0.0.9',
            cors: ['https://ui.test'],
            password: 'secret',
            username: 'alice',
            cwd: '/tmp',
            defaultModel: 'openai/gpt-4o-mini',
            sessionStore: fakeStore,
        });
        expect(outputs.some((line) => line.includes('Serve listening'))).toBe(true);

        const response = await serverOptions[0].runMessage({
            projectRoot: '/tmp',
            sessionId: 'session-1',
            message: 'hello',
            attachments: [],
        });
        expect(response).toEqual({
            response: 'reply:hello',
            sessionId: 'session-1',
        });
        expect(sendCalls[0].settings).toEqual({
            dir: '/tmp',
            model: 'openai/gpt-4o-mini',
            agent: 'general',
            sandboxMode: 'project',
        });

        const streamedEvents: unknown[] = [];
        const streamed = await serverOptions[0].runMessageStream({
            projectRoot: '/tmp',
            sessionId: 'session-2',
            message: 'stream',
            attachments: [],
            onEvent: (event: unknown) => streamedEvents.push(event),
            requestQuestion: async (prompt: { requestId: string }) => ({
                requestId: prompt.requestId,
                selected: [],
            }),
            requestToolApproval: async () => false,
        });

        expect(streamed).toEqual({
            response: 'reply:stream',
            sessionId: 'session-2',
        });
        expect(streamedEvents).toHaveLength(1);
    });
});
