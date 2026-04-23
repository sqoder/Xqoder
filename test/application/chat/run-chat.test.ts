import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import {
    runChat,
    runChatHeadless,
    runChatMessageStream,
    runNonInteractivePrompt,
} from '../../../src/application/chat/run-chat.js';
import type { AgentCallbacks } from '../../../src/core/agent/agent.js';
import { XQoderAgent } from '../../../src/core/agent/agent.js';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import {
    createMvpTypeErrorDemoProvider,
    createMvpTypeErrorDemoWorkspace,
    MVP_TYPEERROR_DEMO_PROMPT,
} from '../../../src/core/agent/mvp/demo.js';
import { FileRollbackStore } from '../../../src/core/agent/tools/rollback-store.js';

const tempDirs: string[] = [];
const descriptorRestorers: Array<() => void> = [];

afterEach(() => {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('chat runtime helpers', () => {
    it('throws when headless chat cannot resolve a session store', async () => {
        const cwd = createTempDir();

        await expect(runChatHeadless('hello', { dir: cwd })).rejects.toThrow('Session storage unavailable');
    });

    it('reuses an explicit session, augments project prompts, forwards attachments, and saves the response', async () => {
        const cwd = createProjectDir();
        const explicitSession = { id: 'session-explicit' };
        const savedSession = { id: 'session-saved' };
        const savedCalls: Array<Record<string, unknown>> = [];
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
            attachments?: Array<Record<string, unknown>>;
        } = {};

        const sessionStore = {
            findLatestSession: () => null,
            getSession: (sessionId: string) => (sessionId === explicitSession.id ? explicitSession : null),
            saveSession: (input: Record<string, unknown>) => {
                savedCalls.push(input);
                return { id: 'summary-1' };
            },
        };

        const result = await runChatHeadless('请解释这个项目', {
            dir: cwd,
            session: explicitSession.id,
            attachments: [{ type: 'file', filePath: path.join(cwd, 'README.md') }],
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore,
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt, callbacks, attachments) => {
                        received.prompt = prompt;
                        received.attachments = attachments as Array<Record<string, unknown>>;
                        callbacks?.onToken?.('Demo response');
                    },
                    session: savedSession,
                    response: 'Demo response',
                });
            },
        });

        expect(result).toEqual({ response: 'Demo response', sessionId: 'summary-1' });
        expect(received.config?.session).toBe(explicitSession);
        expect(String(received.prompt)).toContain('[AutoProjectContext]');
        expect(String(received.prompt)).toContain('demo-project');
        expect(received.attachments).toEqual([{ type: 'file', filePath: path.join(cwd, 'README.md') }]);
        expect(savedCalls).toHaveLength(1);
        expect(savedCalls[0]?.projectRoot).toBe(cwd);
        expect(savedCalls[0]?.cwd).toBe(cwd);
        expect(savedCalls[0]?.session).toBe(savedSession);
    });

    it('surfaces the current API key guidance when no key is configured and no injected agent factory is provided', async () => {
        const cwd = createTempDir();

        await expect(runChatHeadless('hello', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'unused' }),
            },
        })).rejects.toThrow('auth login');
    });

    it('allows injected headless chat runtimes to bypass the API key gate for tests and local adapters', async () => {
        const cwd = createTempDir();

        const result = await runChatHeadless('hello', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'injected-headless-summary' }),
            },
            agentFactory: () => createFakeAgent({
                response: 'INJECTED_HEADLESS_RESPONSE',
            }),
        });

        expect(result).toEqual({
            response: 'INJECTED_HEADLESS_RESPONSE',
            sessionId: 'injected-headless-summary',
        });
    });

    it('allows local provider headless chat to proceed without an api key', async () => {
        const cwd = createTempDir();

        const result = await runChatHeadless('hello', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('', { provider: 'local', model: 'qwen3:8b' }) },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'local-summary' }),
            },
            agentFactory: () => createFakeAgent({
                response: 'LOCAL_RESPONSE',
            }),
        });

        expect(result).toEqual({
            response: 'LOCAL_RESPONSE',
            sessionId: 'local-summary',
        });
    });

    it('persists envelope-backed session state for headless turns', async () => {
        const cwd = createTempDir();
        const persistedSessions: AgentSession[] = [];
        const agentSession = new AgentSession({
            id: 'headless-envelope-session',
            systemPrompt: 'system',
        });

        const result = await runChatHeadless('hello envelope headless', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: (input: Record<string, unknown>) => {
                    persistedSessions.push(input.session as AgentSession);
                    return { id: 'headless-envelope-summary' };
                },
            },
            agentFactory: () => createFakeAgent({
                session: agentSession,
                response: 'HEADLESS_ENVELOPE_RESPONSE',
            }),
        });

        expect(result).toEqual({
            response: 'HEADLESS_ENVELOPE_RESPONSE',
            sessionId: 'headless-envelope-summary',
        });
        expect(persistedSessions).toHaveLength(1);
        expect(persistedSessions[0]?.getConversationEventEnvelopes().map((event) => event.type)).toEqual(expect.arrayContaining([
            'session.started',
            'message.started',
            'message.completed',
            'status.changed',
        ]));
    });

    it('renders JSON output for interactive chat through the injected runtime and persists the session', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const stderr = captureStream(process.stderr, 'write');
        const savedCalls: Array<Record<string, unknown>> = [];

        await runChat('hello from interactive', {
            dir: cwd,
            format: 'json',
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: (input: Record<string, unknown>) => {
                    savedCalls.push(input);
                    return { id: 'interactive-summary' };
                },
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onToken?.('Hello');
                    callbacks?.onToken?.(' world');
                },
                response: 'unused when callbacks accumulate',
            }),
        }, () => ({
            onToken() {},
        }));

        expect(savedCalls).toHaveLength(1);
        expect(stdout.value).toContain('"response": "Hello world"');
        expect(stdout.value.trim().endsWith('}')).toBe(true);
        expect(stderr.value).toContain('\r');
    });

    it('renders /permissions as a direct response without creating an agent', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        let agentFactoryCalled = false;

        await runChat('/permissions', {
            dir: cwd,
            format: 'text',
        }, {
            configManager: {
                load: () => createLoadedConfig('', {
                    permissions: {
                        defaultMode: 'allow',
                        tools: { bash: 'deny' },
                    },
                }),
                getLoadMetadata: () => ({ sources: [] }),
            },
            agentFactory: () => {
                agentFactoryCalled = true;
                return createFakeAgent({
                    response: 'UNUSED',
                });
            },
        }, () => ({
            onToken() {},
        }));

        expect(agentFactoryCalled).toBe(false);
        expect(stdout.value).toContain(`cwd=${cwd}`);
        expect(stdout.value).toContain('effectiveApprovalPolicy=workspace_auto');
        expect(stdout.value).toContain('effectiveDefaultMode=allow');
        expect(stdout.value).toContain('effectiveTools=bash:deny');
    });

    it('runs non-interactive prompts with scoped permission overrides, a generated session title, and formatted text output', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: 'Summarize the repo status',
            cwd,
            outputFormat: 'text',
            quiet: true,
            permissionMode: 'allow',
            allowedTools: ['read_file', 'write_file'],
            disallowedTools: ['bash'],
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'non-interactive-summary' }),
            },
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt, callbacks) => {
                        received.prompt = prompt;
                        callbacks?.onToken?.('TEXT_RESPONSE');
                    },
                    response: 'TEXT_RESPONSE',
                });
            },
        });

        expect(received.config?.autoApproveTools).toBe(false);
        expect(received.config?.permissions).toMatchObject({
            approvalPolicy: 'workspace_auto',
            allowedTools: ['read_file', 'write_file'],
            disallowedTools: ['bash'],
        });
        expect(String(received.config?.sessionTitle)).toContain('Non-interactive: Summarize the repo status');
        expect(received.prompt).toBe('Summarize the repo status');
        expect(stdout.value).toContain('TEXT_RESPONSE');
    });

    it('routes /plan through the shared workflow command path before agent execution', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: '/plan stabilize the command router',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'plan-summary' }),
            },
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt, callbacks) => {
                        received.prompt = prompt;
                        callbacks?.onToken?.('PLAN_RESPONSE');
                    },
                    response: 'PLAN_RESPONSE',
                });
            },
        });

        expect(received.config?.agentName).toBe('plan');
        expect(received.config?.runtimeProfile).toBe('hybrid');
        expect(received.prompt).toContain('Mode: PLAN');
        expect(received.prompt).toContain('User request: stabilize the command router');
        expect(received.prompt).not.toContain('/plan stabilize the command router');
        expect(stdout.value).toContain('PLAN_RESPONSE');
    });

    it('records the latest successful /plan turn as session-scoped workflow approval metadata', async () => {
        const cwd = createTempDir();
        const session = new AgentSession({
            id: 'plan-approval-session',
            systemPrompt: 'system',
        });

        await runChatHeadless('/plan stabilize the command router', {
            dir: cwd,
            session: session.id,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => session,
                getSession: () => session,
                saveSession: () => ({ id: session.id }),
            },
            agentFactory: () => createFakeAgent({
                session,
                response: 'PLAN_RECORDED',
            }),
        });

        expect(session.getWorkflowState()).toMatchObject({
            kind: 'plan',
            rawGoal: 'stabilize the command router',
            normalizedGoal: 'stabilize the command router',
            sourceTurnId: expect.stringContaining(`${session.id}:turn:`),
        });
    });

    it('routes /implement through the planning workflow when there is no matching approved plan in the session', async () => {
        const cwd = createTempDir();
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: '/implement stabilize the command router',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'implement-plan-summary' }),
            },
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt) => {
                        received.prompt = prompt;
                    },
                    response: 'IMPLEMENT_REROUTED_TO_PLAN',
                });
            },
        });

        expect(received.config?.agentName).toBe('plan');
        expect(received.prompt).toContain('Mode: PLAN');
        expect(received.prompt).toContain('User request: stabilize the command router');
    });

    it('lets /implement enter engineering mode when the current session has a matching approved plan', async () => {
        const cwd = createTempDir();
        const session = new AgentSession({
            id: 'implement-approved-session',
            systemPrompt: 'system',
        });
        session.recordWorkflowState({
            kind: 'plan',
            rawGoal: 'stabilize the command router',
            normalizedGoal: 'stabilize the command router',
            completedAt: new Date('2026-04-23T00:00:00.000Z'),
            sourceTurnId: `${session.id}:turn:plan`,
        });
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: '/implement stabilize the command router',
            cwd,
            outputFormat: 'text',
            quiet: true,
            continue: true,
        }, {
            configManager: {
                load: () => createLoadedConfig('test-key', {
                    permissions: {
                        defaultMode: 'allow',
                        tools: {},
                    },
                }),
            },
            sessionStore: {
                findLatestSession: () => session,
                getSession: () => session,
                saveSession: () => ({ id: session.id }),
            },
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt) => {
                        received.prompt = prompt;
                    },
                    response: 'IMPLEMENT_EXECUTES',
                    session,
                });
            },
        });

        expect(received.config?.taskMode).toBe('engineering_edit');
        expect(received.prompt).toBe('stabilize the command router');
        expect(received.prompt).not.toContain('Mode: PLAN');
        expect(session.getWorkflowState()).toBeUndefined();
    });

    it('surfaces the current API key guidance for non-interactive prompts before provider execution', async () => {
        const cwd = createTempDir();

        await expect(runNonInteractivePrompt({
            prompt: 'hello',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'unused' }),
            },
        })).rejects.toThrow('auth login');
    });

    it('emits standard app events from the shared chat message stream helper', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        const result = await runChatMessageStream({
            prompt: 'hello stream',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'stream-summary' }),
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onThinkingToken?.('plan');
                    callbacks?.onToken?.('Hel');
                    callbacks?.onToken?.('lo');
                    callbacks?.onToolStart?.('search_code', { query: 'hello' });
                    callbacks?.onToolStream?.('search_code', 'match line', 'stdout');
                    callbacks?.onToolEnd?.('search_code', 'search complete', true);
                },
                response: 'Hello',
            }),
        });

        expect(result).toEqual({
            response: 'Hello',
            sessionId: 'stream-summary',
        });
        expect(events.map((event) => event.type)).toEqual([
            'session.started',
            'message.started',
            'message.completed',
            'status.changed',
            'thought',
            'message.started',
            'message.delta',
            'message.delta',
            'tool.called',
            'status.changed',
            'tool.output',
            'tool.output',
            'tool.completed',
            'status.changed',
            'message.completed',
            'status.changed',
        ]);
        for (const event of events) {
            expectStandardEnvelopeShape(event, event.type);
        }
        expect(events.find((event) => event.type === 'tool.called')).toMatchObject({
            type: 'tool.called',
            payload: {
                tool: 'search_code',
            },
        });
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
    });

    it('bridges fallback agent callback events through the interactive envelope stream', async () => {
        const cwd = createTempDir();
        const observed: string[] = [];

        await runChat('bridge callbacks', {
            dir: cwd,
            format: 'text',
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'callback-bridge-summary' }),
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onIteration?.(1);
                    callbacks?.onThinkingToken?.('thinking');
                    callbacks?.onToolStart?.('read_file', { path: 'src/index.ts' });
                    callbacks?.onToolStream?.('read_file', 'partial output', 'stdout');
                    callbacks?.onToolEnd?.('read_file', 'complete output', true);
                    callbacks?.onEvent?.({
                        id: 'usage-1',
                        streamId: 'callback-bridge',
                        timestamp: new Date(0).toISOString(),
                        type: 'usage',
                        model: 'gpt-4.1',
                        promptTokens: 1,
                        completionTokens: 2,
                        totalTokens: 3,
                    } as any);
                    callbacks?.onEvent?.({
                        id: 'error-1',
                        streamId: 'callback-bridge',
                        timestamp: new Date(0).toISOString(),
                        type: 'error',
                        message: 'side-channel error',
                        fatal: false,
                    } as any);
                    callbacks?.onToken?.('BRIDGED');
                },
                response: 'BRIDGED',
            }),
        }, () => ({
            onToken: (token) => observed.push(`token:${token}`),
            onThinkingToken: (token) => observed.push(`thought:${token}`),
            onToolStart: (name, args) => observed.push(`tool-start:${name}:${args.path}`),
            onToolStream: (name, chunk, stream) => observed.push(`tool-stream:${name}:${stream}:${chunk}`),
            onToolEnd: (name, output, success) => observed.push(`tool-end:${name}:${success}:${output}`),
            onError: (error) => observed.push(`error:${error.message}`),
        }));

        expect(observed).toEqual(expect.arrayContaining([
            'thought:thinking',
            'tool-start:read_file:src/index.ts',
            'tool-stream:read_file:stdout:partial output',
            'tool-end:read_file:true:complete output',
            'error:side-channel error',
            'token:BRIDGED',
        ]));
    });

    it('emits question request and resolution events from the fallback agent path', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        const result = await runChatMessageStream({
            prompt: 'ask a structured question',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
            requestQuestion: async (prompt) => ({
                requestId: prompt.requestId,
                selected: ['Use strict mode'],
                customText: 'custom answer',
            }),
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'question-summary' }),
            },
            agentFactory: () => createFakeAgent({
                async onRun(_prompt, callbacks) {
                    await callbacks?.onQuestion?.({
                        requestId: 'question-1',
                        question: 'Which mode?',
                        header: 'Mode',
                        options: [{ label: 'Use strict mode' }],
                        multiple: true,
                        allowCustom: true,
                    });
                    callbacks?.onToken?.('QUESTION_DONE');
                },
                response: 'QUESTION_DONE',
            }),
        });

        expect(result.response).toBe('QUESTION_DONE');
        expect(events.find((event) => event.type === 'question.requested')).toMatchObject({
            payload: {
                requestId: 'question-1',
                question: 'Which mode?',
                header: 'Mode',
                multiple: true,
                allowCustom: true,
            },
        });
        expect(events.find((event) => event.type === 'question.resolved')).toMatchObject({
            payload: {
                requestId: 'question-1',
                selected: ['Use strict mode'],
                customText: 'custom answer',
                answerSource: 'ui',
            },
        });
    });

    it('emits synthetic terminal events when a canonical stream fails before terminal metadata', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];
        const session = new AgentSession({
            id: 'canonical-stream-failure-session',
            systemPrompt: 'system',
        });

        await expect(runChatMessageStream({
            prompt: 'stream failure',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'unused' }),
            },
            agentFactory: () => ({
                async *streamTurn() {
                    throw new Error('canonical stream broke');
                },
                getSession() {
                    return session;
                },
                async dispose() {},
            }),
        })).rejects.toThrow('canonical stream broke');

        expect(events.at(-2)).toMatchObject({
            type: 'error',
            payload: {
                message: 'canonical stream broke',
            },
        });
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'error',
                stopReason: 'provider_error',
                message: 'canonical stream broke',
            },
        });
    });

    it('handles /status through a direct runtime response without invoking an agent', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];
        let agentFactoryCalled = false;

        const result = await runChatMessageStream({
            prompt: '/status',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('') },
            agentFactory: () => {
                agentFactoryCalled = true;
                return createFakeAgent({
                    response: 'UNUSED',
                });
            },
        });

        expect(agentFactoryCalled).toBe(false);
        expect(result.response).toContain('Runtime status:');
        expect(result.response).toContain('model=gpt-4.1');
        expect(result.response).toContain('persistence=disabled');
        expect(events.map((event) => event.type)).toEqual([
            'session.started',
            'message.started',
            'message.completed',
            'status.changed',
            'message.started',
            'message.completed',
            'status.changed',
        ]);
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                source: 'runtime',
                stopReason: 'completed',
            },
        });
    });

    it('handles /tools through a shared direct runtime response without invoking the model', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        const result = await runChatMessageStream({
            prompt: '/tools',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: {
                load: () => createLoadedConfig('', {
                    permissions: {
                        defaultMode: 'allow',
                        tools: {
                            bash: 'deny',
                        },
                    },
                }),
            },
        });

        expect(result.response).toContain('Visible tools for this turn:');
        expect(result.response).toContain('read_file (');
        expect(result.response).toContain('search_code (');
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
    });

});

function createLoadedConfig(
    apiKey: string,
    options: {
        provider?: 'openai' | 'local' | 'dashscope';
        model?: string;
        permissions?: {
            defaultMode?: 'allow' | 'ask' | 'deny';
            tools?: Record<string, 'allow' | 'ask' | 'deny'>;
            approvalPolicy?: 'strict' | 'balanced' | 'workspace_auto';
            allowedTools?: string[];
            disallowedTools?: string[];
        };
    } = {},
) {
    const provider = options.provider ?? 'openai';
    const model = options.model ?? 'gpt-4.1';

    return {
        llm: {
            provider,
            model,
            apiKey,
        },
        providers: {
            [provider]: {
                apiKey,
                defaultModel: model,
                ...(provider === 'local'
                    ? { baseUrl: 'http://localhost:11434/v1' }
                    : {}),
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider,
                model,
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
        ...(options.permissions
            ? {
                permissions: options.permissions,
            }
            : {}),
    };
}

function createFakeAgent(options: {
    response?: string;
    session?: Record<string, unknown>;
    onRun?: (
        prompt: string,
        callbacks?: AgentCallbacks,
        attachments?: Array<Record<string, unknown>>,
    ) => void | Promise<void>;
}) {
    return {
        async run(
            prompt: string,
            callbacks?: AgentCallbacks,
            attachments?: Array<Record<string, unknown>>,
        ) {
            if (options.onRun) {
                await options.onRun(prompt, callbacks, attachments);
            } else if (options.response) {
                callbacks?.onToken?.(options.response);
            }

            return options.response ?? '';
        },
        getSession() {
            return options.session ?? { id: 'agent-session' };
        },
        async dispose() {},
    };
}

function createAgentWithStreamingUsage(config: Record<string, unknown>): XQoderAgent {
    return new XQoderAgent({
        ...(config as any),
        providerFactory: async () => ({
            name: 'fake-provider',
            model: 'fake-model',
            async complete() {
                throw new Error('complete() should not be used');
            },
            async stream(_request: unknown, callbacks?: AgentCallbacks) {
                callbacks?.onToken?.('USAGE_');
                callbacks?.onToken?.('CHAIN');
                return {
                    finishReason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'USAGE_CHAIN',
                    },
                    usage: {
                        promptTokens: 17,
                        completionTokens: 4,
                        totalTokens: 21,
                    },
                };
            },
        }),
    });
}

function createProjectDir(): string {
    const cwd = createTempDir();
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Demo Project\n\nA sample app.\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
        name: 'demo-project',
        description: 'Sample terminal app',
        scripts: {
            build: 'bun run build',
            test: 'bun test',
        },
    }, null, 2));
    return cwd;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-run-chat-'));
    tempDirs.push(dir);
    return dir;
}

function captureStream<
    T extends { [K in P]: (...args: any[]) => unknown },
    P extends keyof T,
>(target: T, property: P): { value: string } {
    const previous = Object.getOwnPropertyDescriptor(target, property);
    const captured = { value: '' };

    Object.defineProperty(target, property, {
        configurable: true,
        value: ((chunk: unknown) => {
            captured.value += String(chunk ?? '');
            return true;
        }) as T[P],
    });

    descriptorRestorers.push(() => {
        if (previous) {
            Object.defineProperty(target, property, previous);
            return;
        }
        delete (target as Record<string, unknown>)[property as string];
    });

    return captured;
}

function expectStandardEnvelopeShape(
    event: ConversationEventEnvelope | undefined,
    type: ConversationEventEnvelope['type'],
): void {
    expect(event).toMatchObject({
        schemaVersion: 1,
        type,
        eventId: expect.any(String),
        sessionId: expect.any(String),
        turnId: expect.any(String),
        timestamp: expect.any(String),
        payload: expect.any(Object),
    });
}
