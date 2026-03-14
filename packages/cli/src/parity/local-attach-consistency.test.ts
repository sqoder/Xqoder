import { afterEach, describe, expect, it } from 'vitest';
import type * as http from 'node:http';
import { createServer } from '../server/index.js';
import { RemoteTuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { reduceTerminalAppState } from '../terminal-app/reducer.js';
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
        listSessions: () => {
            const now = new Date();
            return [{
                id: 's1',
                projectRoot: '/tmp/project',
                cwd: '/tmp/project',
                model: 'openai/gpt-4o',
                title: 'Session 1',
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 },
            }];
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

function reduceWithEvents(events: AppEvent[]) {
    return events.reduce((state, event) => {
        return reduceTerminalAppState(state, { type: 'runtime', event });
    }, createInitialTerminalAppState({ width: 120, height: 40 }));
}

describe('parity: local vs attach consistency', () => {
    const cleanup: Array<() => Promise<void>> = [];

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop();
            if (fn) await fn();
        }
    });

    it('produces equivalent terminal state from same protocol semantics', async () => {
        const scriptedEvents: AppEvent[] = [];

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
                params.onEvent({
                    type: 'question.requested',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: 'q1',
                    question: 'Choose mode',
                    options: [{ label: 'Parity' }, { label: 'Speed' }],
                });
                const answer = await params.requestQuestion({
                    requestId: 'q1',
                    question: 'Choose mode',
                    options: [{ label: 'Parity' }, { label: 'Speed' }],
                });
                params.onEvent({
                    type: 'question.resolved',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    requestId: 'q1',
                    selected: answer.selected,
                    answerSource: 'ui',
                });
                params.onEvent({
                    type: 'message.started',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    message: {
                        id: 'a1',
                        sessionId: 's1',
                        role: 'assistant',
                        content: '',
                        createdAt: Date.now(),
                    },
                });
                params.onEvent({
                    type: 'message.delta',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    messageId: 'a1',
                    role: 'assistant',
                    text: 'Hello from attach parity',
                });
                params.onEvent({
                    type: 'message.completed',
                    sessionId: 's1',
                    timestamp: Date.now(),
                    source: 'agent',
                    message: {
                        id: 'a1',
                        sessionId: 's1',
                        role: 'assistant',
                        content: 'Hello from attach parity',
                        createdAt: Date.now(),
                    },
                });
                return { response: 'Hello from attach parity', sessionId: 's1' };
            },
        });
        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const remote = new RemoteTuiAgentService(baseUrl);
        const settings: TuiAgentSettings = {
            dir: '/tmp/project',
            model: 'openai/gpt-4o',
            agent: 'general',
            sandboxMode: 'project',
        };
        await remote.sendMessage('hello', 's1', settings, [], {
            onEvent: (event) => {
                scriptedEvents.push(event);
            },
            onQuestion: async (request) => ({
                requestId: request.requestId,
                selected: ['Parity'],
            }),
        });

        const attachState = reduceWithEvents(scriptedEvents);

        const localSemanticEvents: AppEvent[] = [
            ...scriptedEvents,
        ];
        const localState = reduceWithEvents(localSemanticEvents);

        expect(attachState.runtimeStatus).toBe(localState.runtimeStatus);
        expect(attachState.pendingQuestion).toBeUndefined();
        expect(localState.pendingQuestion).toBeUndefined();
        expect(attachState.transcriptEntries.map((entry) => ({ role: entry.role, content: entry.content, success: entry.success })))
            .toEqual(localState.transcriptEntries.map((entry) => ({ role: entry.role, content: entry.content, success: entry.success })));
    });
});
