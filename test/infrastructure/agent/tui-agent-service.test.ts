import { describe, expect, it, spyOn } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import type { TuiAgentSettings } from '../../../src/application/agent/index.js';
import { TuiAgentService } from '../../../src/infrastructure/agent/tui-agent-service.js';

const settings: TuiAgentSettings = {
    dir: '/workspace/demo',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project',
};

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
                    yield {
                        type: 'error',
                        sessionId: activeSession.id,
                        timestamp: 1,
                        source: 'runtime',
                        message: 'runtime failed',
                        recoverable: false,
                    };
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
                async *runAgent() {
                    yield {
                        type: 'message.completed',
                        sessionId: 'saved-session',
                        timestamp: 1,
                        source: 'agent',
                        message: {
                            id: 'assistant-1',
                            sessionId: 'saved-session',
                            role: 'assistant',
                            content: 'hello back',
                            createdAt: 1,
                        },
                    };
                },
            },
            debugLogger: {
                logRequest() {},
                logResponse() {},
            },
        });

        const result = await service.instance.sendMessage('hello', undefined, settings, [], {
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

        service.currentAgent = {
            cancel,
            dispose,
        };
        await service.instance.dispose();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(service.currentAgent).toBeNull();
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
