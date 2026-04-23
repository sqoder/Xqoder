import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { runRunCommand } from '../../src/commands/workflows/run.js';

describe('run command surface', () => {
    it('forwards local run options into chat execution and creates a share from the persisted session', async () => {
        const calls: Array<Record<string, unknown>> = [];

        await runRunCommand('hello local run', {
            dir: '/workspace/demo',
            share: true,
            format: 'json',
            title: 'Shareable Session',
        }, {
            runLocalCommand: async (message, options) => {
                calls.push({
                    kind: 'local',
                    message,
                    options,
                });
                return {
                    response: 'local response',
                    sessionId: 'session-local-1',
                };
            },
            createShare: (sessionId, projectRoot) => {
                calls.push({
                    kind: 'share',
                    sessionId,
                    projectRoot,
                });
            },
        });

        expect(calls).toEqual([
            {
                kind: 'local',
                message: 'hello local run',
                options: {
                    dir: path.resolve('/workspace/demo'),
                    model: undefined,
                    agent: undefined,
                    session: undefined,
                    newSession: true,
                    format: 'json',
                    attachments: undefined,
                    title: 'Shareable Session',
                },
            },
            {
                kind: 'share',
                sessionId: 'session-local-1',
                projectRoot: path.resolve('/workspace/demo'),
            },
        ]);
    });

    it('uses remote attach mode and creates a fresh remote session by default', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const output = await captureStdout(async () => {
            await runRunCommand('hello remote run', {
                dir: '/workspace/demo',
                attach: 'example.test',
                port: 7071,
                title: 'Remote Session',
                format: 'json',
            }, {
                createRemoteAgentService: (baseUrl) => {
                    calls.push({
                        kind: 'factory',
                        baseUrl,
                    });

                    return {
                        isBusy: false,
                        cancel: () => {},
                        compactSession: async () => null,
                        listSessions: async () => [],
                        getSessionMessages: async () => ({ messages: [] }),
                        createSession: async (projectRoot, title) => {
                            calls.push({
                                kind: 'create',
                                projectRoot,
                                title,
                            });
                            return {
                                id: 'remote-session-1',
                                title: title ?? 'Remote Session',
                            };
                        },
                        sendMessage: async (message, sessionId, settings, attachments, callbacks) => {
                            calls.push({
                                kind: 'send',
                                message,
                                sessionId,
                                settings,
                                attachments,
                            });
                            callbacks.onEvent({
                                type: 'message.completed',
                                payload: {
                                    message: {
                                        id: 'assistant-1',
                                        sessionId: 'remote-session-1',
                                        role: 'assistant',
                                        content: 'remote response',
                                        createdAt: Date.now(),
                                    },
                                },
                            } as any);
                            return { sessionId: sessionId ?? 'remote-session-1' };
                        },
                        dispose: async () => {
                            calls.push({ kind: 'dispose' });
                        },
                    } as any;
                },
            });
        });

        expect(calls).toEqual([
            {
                kind: 'factory',
                baseUrl: 'http://example.test:7071',
            },
            {
                kind: 'create',
                projectRoot: path.resolve('/workspace/demo'),
                title: 'Remote Session',
            },
            {
                kind: 'send',
                message: 'hello remote run',
                sessionId: 'remote-session-1',
                settings: {
                    dir: path.resolve('/workspace/demo'),
                    model: 'remote',
                    agent: 'general',
                    sandboxMode: 'project',
                },
                attachments: [],
            },
            {
                kind: 'dispose',
            },
        ]);
        expect(output).toBe('"remote response"\n');
    });
});

async function captureStdout(action: () => Promise<void>): Promise<string> {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = '';

    process.stdout.write = ((chunk: string | Uint8Array) => {
        output += typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString('utf-8');
        return true;
    }) as typeof process.stdout.write;

    try {
        await action();
    } finally {
        process.stdout.write = originalWrite;
    }

    return output;
}
