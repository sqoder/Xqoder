import { describe, expect, it } from 'bun:test';
import { AgentSession } from '@xqoder/agent';
import type { TuiAgentSettings } from '../../../src/application/agent/index.js';
import {
    compactTuiAgentSession,
    persistTuiAgentSession,
    resolveTuiAgentSendContext,
} from '../../../src/infrastructure/agent/tui-agent-session-operations.js';

const settings: TuiAgentSettings = {
    dir: '/workspace/demo',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project',
};

describe('tui agent session operations', () => {
    it('returns null for compaction when the session has too few non-system messages', async () => {
        let summarizerCalls = 0;
        const session = new AgentSession({ systemPrompt: 'system prompt' });
        seedSessionMessages(session, [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ]);

        const sessionStore = createSessionStore(session);
        const result = await compactTuiAgentSession(sessionStore, session.id, settings, {
            resolveAgentConfig: () => createResolvedAgentConfig(),
            createSummarizer: () => ({
                async summarize() {
                    summarizerCalls += 1;
                    return 'summary';
                },
            }),
        });

        expect(result).toBeNull();
        expect(summarizerCalls).toBe(0);
    });

    it('creates a fresh active session when no previous session id is provided', () => {
        const sessionStore = createSessionStore();

        const context = resolveTuiAgentSendContext(sessionStore, undefined, settings, {
            resolveAgentConfig: () => createResolvedAgentConfig(),
        });

        expect(context.session).toBeUndefined();
        expect(context.activeSession).toBeInstanceOf(AgentSession);
        expect(context.activeSession.getMessages()).toEqual([
            { role: 'system', content: 'system prompt' },
        ]);
        expect(context.activeSession.id).toBe(context.agentConfig.session.id);
        expect(context.permissions).toEqual({ tools: { shell: 'ask' } });
    });

    it('persists the session and backfills a generated title when the saved title is still generic', async () => {
        const sessionStore = createSessionStore();
        const activeSession = new AgentSession({ systemPrompt: 'system prompt' });
        const titleUpdates: Array<{ id: string; title: string }> = [];
        const generatedTitles: Array<{ id: string; title: string }> = [];

        sessionStore.saveSession = () => ({
            id: activeSession.id,
            title: 'hello world',
            lastUserMessage: 'hello world',
        });
        sessionStore.updateSessionTitle = (id: string, title: string) => {
            titleUpdates.push({ id, title });
        };

        const result = persistTuiAgentSession({
            sessionStore,
            activeSession,
            resolvedDir: '/workspace/demo',
            agentConfig: {
                ...createResolvedAgentConfig().baseAgentConfig,
                session: activeSession,
            },
            userMessage: 'hello world',
            onTitleGenerated: (id, title) => {
                generatedTitles.push({ id, title });
            },
        }, {
            createTitleAgent: () => ({
                async generateTitle() {
                    return 'Generated Title';
                },
            }),
        });

        await tick();

        expect(result).toEqual({
            sessionId: activeSession.id,
            sessionTitle: 'hello world',
        });
        expect(titleUpdates).toEqual([{ id: activeSession.id, title: 'Generated Title' }]);
        expect(generatedTitles).toEqual([{ id: activeSession.id, title: 'Generated Title' }]);
    });
});

function createResolvedAgentConfig() {
    return {
        resolvedDir: '/workspace/demo',
        permissions: { tools: { shell: 'ask' } },
        baseAgentConfig: {
            systemPrompt: 'system prompt',
            llmConfig: {
                model: 'gpt-4.1',
            },
        },
    } as const;
}

function createSessionStore(session?: AgentSession) {
    const storedSession = session ?? null;
    return {
        getSession(sessionId: string) {
            return storedSession?.id === sessionId ? storedSession : null;
        },
        saveSession() {
            return {
                id: storedSession?.id ?? 'saved-session',
                title: 'saved title',
                lastUserMessage: 'saved message',
            };
        },
        updateSessionTitle() {},
    } as unknown as {
        getSession(sessionId: string): AgentSession | null;
        saveSession(...args: unknown[]): { id: string; title?: string; lastUserMessage?: string };
        updateSessionTitle(id: string, title: string): void;
    };
}

function seedSessionMessages(
    session: AgentSession,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): void {
    for (const message of messages) {
        session.addMessage(message.role, message.content);
    }
}

async function tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
