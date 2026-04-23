import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import { createConversationEventEnvelopeEmitter } from '@xqoder/protocol';
import type { AgentRuntimeEvent, TuiAgentSettings } from '../../../src/application/agent/index.js';
import { TuiAgentService } from '../../../src/infrastructure/agent/tui-agent-service.js';

const settings: TuiAgentSettings = {
    dir: '/workspace/demo',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project',
};
const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('TuiAgentService', () => {
    it('returns null when compaction is requested while the service is already busy', async () => {
        const service = createService();
        service.busy = true;

        await expect(service.instance.compactSession('session-1', settings)).resolves.toBeNull();
    });

    it('emits a runtime error event and returns the active session id after a handled agent failure', async () => {
        const activeSession = new AgentSession({ systemPrompt: 'system prompt' });
        const runtimeCalls: Array<{ prompt: string; attachments: unknown[] }> = [];
        const service = createService({
            sessionStore: {
                getSession(sessionId: string) {
                    return sessionId === activeSession.id ? activeSession : null;
                },
                saveSession() {
                    return {
                        id: activeSession.id,
                        title: 'saved title',
                        lastUserMessage: 'hello',
                    };
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent(_name: string, request: { prompt: string; attachments: unknown[] }) {
                    runtimeCalls.push(request);
                    yield createRuntimeEnvelope(activeSession.id, 'error', {
                        source: 'runtime',
                        message: 'runtime failed',
                        recoverable: false,
                    });
                    throw new Error('runtime failed');
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        const events: string[] = [];
        const result = await service.instance.sendMessage('hello', activeSession.id, settings, [], {
            onEvent(event) {
                events.push(event.type);
            },
        });

        expect(result).toEqual({ sessionId: activeSession.id });
        expect(events).toEqual(['error']);
        expect(runtimeCalls).toHaveLength(1);
        expect(runtimeCalls[0]).toMatchObject({
            prompt: 'hello',
            attachments: [],
        });
        expect(service.busy).toBe(false);
        expect(service.currentAgent).toBeNull();
        expect(service.pendingAgentConfig).toBeNull();
    });

    it('persists the session after a successful send and cancels/disposes the active agent on shutdown', async () => {
        const saveCalls: Array<{ projectRoot: string; cwd: string; model: string }> = [];
        let systemPrompt = '';
        const cancel = spyOn({ cancel() {} }, 'cancel');
        const dispose = spyOn({ async dispose() {} }, 'dispose');
        const service = createService({
            sessionStore: {
                getSession() {
                    return null;
                },
                saveSession({ projectRoot, cwd, model }: { projectRoot: string; cwd: string; model: string }) {
                    saveCalls.push({ projectRoot, cwd, model });
                    return {
                        id: 'saved-session',
                        title: 'saved title',
                        lastUserMessage: 'hello',
                    };
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent(_name: string, request: { messages?: Array<{ role: string; content: string }> }) {
                    systemPrompt = request.messages?.find((message) => message.role === 'system')?.content ?? '';
                    yield createRuntimeEnvelope('saved-session', 'message.completed', {
                        source: 'agent',
                        message: {
                            id: 'assistant-1',
                            sessionId: 'saved-session',
                            role: 'assistant',
                            content: 'hello back',
                            createdAt: 1,
                        },
                    });
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        const result = await service.instance.sendMessage('你是什么模型', undefined, settings, [], {
            onEvent() {},
        });

        expect(result).toEqual({
            sessionId: 'saved-session',
            sessionTitle: 'saved title',
        });
        expect(saveCalls).toEqual([
            {
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4.1',
            },
        ]);
        expect(systemPrompt).not.toContain('USER_PROMPT');
        expect(systemPrompt).toContain('configured LLM provider/model');
        expect(systemPrompt).toContain('do not say you are not a language model');
        expect(systemPrompt).toContain('This overrides generic default-agent English preferences');

        service.currentAgent = {
            cancel,
            dispose,
        };
        await service.instance.dispose();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(service.currentAgent).toBeNull();
    });

    it('augments TUI project-explanation prompts with inspected workspace context before runtime execution', async () => {
        const cwd = createProjectDir();
        const runtimeCalls: Array<{ prompt: string }> = [];
        const service = createService({
            sessionStore: {
                getSession() {
                    return null;
                },
                saveSession() {
                    return {
                        id: 'saved-session',
                        title: 'saved title',
                        lastUserMessage: '解释这个项目',
                    };
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent(_name: string, request: { prompt: string }) {
                    runtimeCalls.push({ prompt: request.prompt });
                    yield createRuntimeEnvelope('saved-session', 'message.completed', {
                        source: 'agent',
                        message: {
                            id: 'assistant-1',
                            sessionId: 'saved-session',
                            role: 'assistant',
                            content: 'project summary',
                            createdAt: 1,
                        },
                    });
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        await service.instance.sendMessage('解释这个项目', undefined, {
            ...settings,
            dir: cwd,
        }, [], {
            onEvent() {},
        });

        expect(runtimeCalls).toHaveLength(1);
        expect(runtimeCalls[0]?.prompt).toContain('[AutoProjectContext]');
        expect(runtimeCalls[0]?.prompt).toContain('Project root:');
        expect(runtimeCalls[0]?.prompt).toContain('tui-phase1-demo');
        expect(runtimeCalls[0]?.prompt).toContain('TUI routing fixture.');
    });

    it('routes /plan through the shared workflow prompt contract before runtime execution', async () => {
        const runtimeCalls: Array<{ prompt: string; runtimeProfile?: string }> = [];
        const service = createService({
            sessionStore: {
                getSession() {
                    return null;
                },
                saveSession() {
                    return {
                        id: 'saved-session',
                        title: 'saved title',
                        lastUserMessage: '/plan stabilize router',
                    };
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent(_name: string, request: { prompt: string }) {
                    runtimeCalls.push({
                        prompt: request.prompt,
                        runtimeProfile: service.pendingAgentConfig?.runtimeProfile as string | undefined,
                    });
                    yield createRuntimeEnvelope('saved-session', 'message.completed', {
                        source: 'agent',
                        message: {
                            id: 'assistant-1',
                            sessionId: 'saved-session',
                            role: 'assistant',
                            content: 'plan reply',
                            createdAt: 1,
                        },
                    });
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        await service.instance.sendMessage('/plan stabilize router', undefined, settings, [], {
            onEvent() {},
        });

        expect(runtimeCalls).toHaveLength(1);
        expect(runtimeCalls[0]?.prompt).toContain('Mode: PLAN');
        expect(runtimeCalls[0]?.prompt).toContain('User request: stabilize router');
        expect(runtimeCalls[0]?.runtimeProfile).toBe('hybrid');
    });

    it('handles /compact through the shared direct-command path without invoking the runtime loop', async () => {
        const activeSession = new AgentSession({
            id: 'tui-compact-session',
            systemPrompt: 'system prompt',
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'hello' },
            ],
        });
        let runtimeCalls = 0;
        const responses: string[] = [];
        const service = createService({
            sessionStore: {
                getSession(sessionId: string) {
                    return sessionId === activeSession.id ? activeSession : null;
                },
                saveSession() {
                    return {
                        id: activeSession.id,
                        title: 'saved title',
                        lastUserMessage: '/compact',
                    };
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent() {
                    runtimeCalls += 1;
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        const result = await service.instance.sendMessage('/compact', activeSession.id, settings, [], {
            onEvent(event) {
                if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
                    responses.push(event.payload.message.content);
                }
            },
        });

        expect(result).toEqual({ sessionId: activeSession.id });
        expect(runtimeCalls).toBe(0);
        expect(responses).toEqual(['Session compaction unavailable or not needed yet.']);
    });

    it('handles /status through the shared direct-command path without invoking the runtime loop', async () => {
        const activeSession = new AgentSession({ systemPrompt: 'system prompt' });
        const runtimeCalls: Array<{ prompt: string }> = [];
        const service = createService({
            sessionStore: {
                getSession(sessionId: string) {
                    return sessionId === activeSession.id ? activeSession : null;
                },
                saveSession() {
                    throw new Error('direct commands should not persist sessions');
                },
                updateSessionTitle() {},
            },
            runtime: {
                async *runAgent(_name: string, request: { prompt: string }) {
                    runtimeCalls.push({ prompt: request.prompt });
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        const events: AgentRuntimeEvent[] = [];
        const result = await service.instance.sendMessage('/status', activeSession.id, settings, [], {
            onEvent(event) {
                events.push(event);
            },
        });

        expect(result).toEqual({ sessionId: activeSession.id });
        expect(runtimeCalls).toHaveLength(0);
        expect(events.map((event) => event.type)).toEqual([
            'session.resumed',
            'message.started',
            'message.completed',
            'status.changed',
            'message.started',
            'message.completed',
            'status.changed',
        ]);
        const completedEvent = events.at(-2);
        if (completedEvent?.type !== 'message.completed') {
            throw new Error('Expected a message.completed envelope before the final status event');
        }
        const assistantContent = String(completedEvent.payload.message.content ?? '');
        expect(assistantContent).toContain('Runtime status:');
        expect(assistantContent).toContain(`session=${activeSession.id}`);
    });
});

function createService(overrides: {
    sessionStore?: {
        getSession?: (sessionId: string) => AgentSession | null;
        saveSession?: (...args: unknown[]) => { id: string; title?: string; lastUserMessage?: string };
        updateSessionTitle?: (sessionId: string, title: string) => void;
    };
    runtime?: {
        runAgent?: (...args: any[]) => AsyncIterable<unknown>;
    };
    debugLogger?: {
        logRequest?: (...args: unknown[]) => void;
        logResponse?: (...args: unknown[]) => void;
    } | null;
} = {}) {
    const target = Object.create(TuiAgentService.prototype) as TuiAgentService & Record<string, unknown>;
    target.sessionStore = {
        getSession: overrides.sessionStore?.getSession ?? (() => null),
        saveSession: overrides.sessionStore?.saveSession ?? (() => ({
            id: 'session-1',
            title: 'saved title',
            lastUserMessage: 'saved message',
        })),
        updateSessionTitle: overrides.sessionStore?.updateSessionTitle ?? (() => {}),
    };
    target.busy = false;
    target.debugLogger = overrides.debugLogger ?? null;
    target.currentAgent = null;
    target.pendingAgentConfig = null;
    target.runtime = {
        runAgent: overrides.runtime?.runAgent ?? (async function* () {
            return;
        }),
    };
    target.runtimeReady = Promise.resolve();

    return {
        instance: target,
        get busy() {
            return target.busy as boolean;
        },
        set busy(value: boolean) {
            target.busy = value;
        },
        get currentAgent() {
            return target.currentAgent as { cancel?: () => void; dispose?: () => Promise<void> } | null;
        },
        set currentAgent(value: { cancel?: () => void; dispose?: () => Promise<void> } | null) {
            target.currentAgent = value;
        },
        get pendingAgentConfig() {
            return target.pendingAgentConfig;
        },
    };
}

function createProjectDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-tui-phase1-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# TUI Phase 1 Demo\n\nTUI routing fixture.\n', 'utf-8');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'tui-phase1-demo',
        description: 'TUI routing fixture',
        scripts: {
            build: 'bun run build',
            test: 'bun test',
        },
    }, null, 2));
    return dir;
}

function createRuntimeEnvelope<TType extends AgentRuntimeEvent['type']>(
    sessionId: string,
    type: TType,
    payload: Extract<AgentRuntimeEvent, { type: TType }>['payload'],
): Extract<AgentRuntimeEvent, { type: TType }> {
    return createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:test`).emitRecord(type, payload);
}
