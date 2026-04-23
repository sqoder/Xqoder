import { describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import { XQoderAgentProvider } from '../../src/core/agent/agent-provider.js';

describe('XQoderAgentProvider', () => {
    it('emits usage events from the underlying agent into the runtime envelope stream', async () => {
        const provider = new XQoderAgentProvider({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
        }, {
            createAgent: () => ({
                subscribe() {
                    return () => {};
                },
                async run(_prompt, callbacks) {
                    callbacks?.onToken?.('usage');
                    callbacks?.onEvent?.({
                        id: 'usage-event-1',
                        streamId: 'stream-usage',
                        timestamp: new Date(0).toISOString(),
                        type: 'usage',
                        model: 'gpt-4.1',
                        promptTokens: 13,
                        completionTokens: 5,
                        totalTokens: 18,
                        cost: 0.123,
                    });
                    return 'usage';
                },
                async dispose() {},
            }),
        });

        const events = [];
        for await (const event of provider.run({
            prompt: 'track usage',
            messages: [],
        } as any, {
            sessionId: 'session-usage',
            cwd: '/workspace/demo',
            permissionPolicy: {
                evaluate: async () => 'allow',
            },
            requestQuestion: async (request) => ({
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }),
        } as any)) {
            events.push(event);
        }

        const usageEvent = events.find((event) => event.type === 'usage');
        expect(usageEvent).toMatchObject({
            type: 'usage',
            sessionId: 'session-usage',
            turnId: expect.any(String),
            payload: {
                source: 'agent',
                model: 'gpt-4.1',
                promptTokens: 13,
                completionTokens: 5,
                totalTokens: 18,
                cost: 0.123,
            },
        });
    });

    it('emits verification events from the underlying agent into the runtime envelope stream', async () => {
        const provider = new XQoderAgentProvider({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
        }, {
            createAgent: () => ({
                subscribe() {
                    return () => {};
                },
                async run(_prompt, callbacks) {
                    callbacks?.onEvent?.({
                        id: 'verification-event-1',
                        streamId: 'stream-verification',
                        timestamp: new Date(0).toISOString(),
                        type: 'verification',
                        ok: false,
                        blocked: true,
                        summary: 'Verification failed',
                    });
                    return 'verification';
                },
                async dispose() {},
            }),
        });

        const events = [];
        for await (const event of provider.run({
            prompt: 'track verification',
            messages: [],
        } as any, {
            sessionId: 'session-verification',
            cwd: '/workspace/demo',
            permissionPolicy: {
                evaluate: async () => 'allow',
            },
            requestQuestion: async (request) => ({
                requestId: request.requestId,
                selected: request.options.length > 0 ? [request.options[0]!.label] : [],
            }),
        } as any)) {
            events.push(event);
        }

        const verificationEvent = events.find((event) => event.type === 'verification.completed');
        expect(verificationEvent).toMatchObject({
            type: 'verification.completed',
            sessionId: 'session-verification',
            turnId: expect.any(String),
            payload: {
                source: 'agent',
                ok: false,
                blocked: true,
                summary: 'Verification failed',
            },
        });
    });

    it('emits terminal stopReason metadata on done and records completed plan workflow state from the streamed agent path', async () => {
        const session = new AgentSession({
            id: 'session-provider-plan',
            systemPrompt: 'system',
        });
        const provider = new XQoderAgentProvider({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            session,
        }, {
            createAgent: () => ({
                async *streamTurn() {
                    yield {
                        schemaVersion: 1,
                        eventId: 'event-1',
                        sessionId: session.id,
                        turnId: `${session.id}:turn:1`,
                        timestamp: new Date(0).toISOString(),
                        type: 'session.resumed',
                        payload: {
                            source: 'agent',
                            messageCount: 1,
                        },
                    } as any;
                    yield {
                        schemaVersion: 1,
                        eventId: 'event-2',
                        sessionId: session.id,
                        turnId: `${session.id}:turn:1`,
                        timestamp: new Date(1).toISOString(),
                        type: 'status.changed',
                        payload: {
                            source: 'agent',
                            status: 'done',
                            stopReason: 'completed',
                        },
                    } as any;
                },
                async run() {
                    return '';
                },
                async dispose() {},
            }),
        });

        const events = [];
        for await (const event of provider.run({
            prompt: '/plan stabilize the command router',
            messages: [],
            metadata: {
                workflow: {
                    kind: 'plan',
                    rawGoal: 'stabilize the command router',
                    normalizedGoal: 'stabilize the command router',
                },
            },
        } as any, {
            sessionId: session.id,
            turnId: `${session.id}:turn:1`,
            cwd: '/workspace/demo',
            permissionPolicy: {
                evaluate: async () => 'allow',
            },
        } as any)) {
            events.push(event);
        }

        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
        expect(session.getWorkflowState()).toMatchObject({
            kind: 'plan',
            rawGoal: 'stabilize the command router',
            normalizedGoal: 'stabilize the command router',
            sourceTurnId: `${session.id}:turn:1`,
        });
    });

    it('emits terminal stopReason metadata on error from the legacy callback path', async () => {
        const provider = new XQoderAgentProvider({
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
        }, {
            createAgent: () => ({
                subscribe() {
                    return () => {};
                },
                async run(_prompt, callbacks) {
                    callbacks?.onStop?.('permission_denied');
                    throw new Error('Tool denied');
                },
                async dispose() {},
            }),
        });

        const events = [];
        for await (const event of provider.run({
            prompt: 'write outside the workspace',
            messages: [],
        } as any, {
            sessionId: 'session-provider-error',
            cwd: '/workspace/demo',
            permissionPolicy: {
                evaluate: async () => 'allow',
            },
        } as any)) {
            events.push(event);
        }

        expect(events.find((event) => event.type === 'error')).toMatchObject({
            type: 'error',
            payload: {
                stopReason: 'permission_denied',
            },
        });
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'error',
                stopReason: 'permission_denied',
            },
        });
    });
});
