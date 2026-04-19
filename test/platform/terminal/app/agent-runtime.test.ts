import { describe, expect, it } from 'bun:test';
import {
    createTerminalSession,
    disposeTerminalAgentRuntime,
    listTerminalSessions,
    loadTerminalSessionHistory,
    restoreTerminalAgentSession,
    type TerminalAgentRuntime,
} from '../../../../src/platform/terminal/app/agent-runtime.js';

function createRuntime() {
    const latestSession = {
        id: 'session-latest',
        getMessages: () => [{ role: 'user', content: 'hi' }],
    };

    const runtime: TerminalAgentRuntime = {
        agentService: {
            isBusy: false,
            cancel() {},
            async compactSession() { return null; },
            async sendMessage() {
                return { sessionId: 'session-latest', response: '' };
            },
            async dispose() {},
        },
        sessionStore: {
            findLatestSession: () => latestSession,
            getSession: (sessionId: string) => (sessionId === latestSession.id ? latestSession : null),
            getSessionSummary: (sessionId: string) => (
                sessionId === latestSession.id
                    ? { id: latestSession.id, title: 'Latest Session', cwd: '/project' }
                    : null
            ),
            listSessions: () => [],
            close() {},
        },
    };

    return runtime;
}

function createRemoteRuntime() {
    const messages = [{ role: 'assistant', content: 'remote-hi' }];
    const remoteService = {
        isBusy: false,
        cancel() {},
        async compactSession() { return null; },
        async sendMessage() {
            return { sessionId: 'remote-session', response: '' };
        },
        async dispose() {},
        async listSessions(_projectRoot: string, _limit?: number) {
            return [{ id: 'remote-session', title: 'Remote Session', updatedAt: new Date().toISOString() }];
        },
        async getSessionMessages(sessionId: string) {
            return {
                messages: sessionId === 'remote-session'
                    ? messages
                    : [],
            };
        },
        async createSession(_projectRoot: string, title?: string) {
            return { id: 'created-remote-session', title: title ?? 'Created Remote Session' };
        },
    };

    const runtime: TerminalAgentRuntime = {
        attachBaseUrl: 'http://localhost:7071',
        agentService: remoteService,
        sessionStore: null,
    };

    return runtime;
}

const settings = {
    dir: '/project',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project' as const,
};

describe('restoreTerminalAgentSession', () => {
    it('does not restore the latest session unless continue or session is provided', async () => {
        const restored = await restoreTerminalAgentSession(createRuntime(), settings, {});
        expect(restored).toBeUndefined();
    });

    it('restores the latest session when continue is enabled', async () => {
        const restored = await restoreTerminalAgentSession(createRuntime(), settings, {
            continue: true,
        });

        expect(restored).toEqual({
            sessionId: 'session-latest',
            title: 'Latest Session',
            cwd: '/project',
            messages: [{ role: 'user', content: 'hi' }],
        });
    });

    it('does not restore remote sessions unless continue or session is provided', async () => {
        const restored = await restoreTerminalAgentSession(createRemoteRuntime(), settings, {});
        expect(restored).toBeUndefined();
    });

    it('restores the latest remote session when continue is enabled', async () => {
        const restored = await restoreTerminalAgentSession(createRemoteRuntime(), settings, {
            continue: true,
        });

        expect(restored).toEqual({
            sessionId: 'remote-session',
            messages: [{ role: 'assistant', content: 'remote-hi' }],
        });
    });

    it('restores an explicitly requested remote session', async () => {
        const restored = await restoreTerminalAgentSession(createRemoteRuntime(), settings, {
            session: 'remote-session',
        });

        expect(restored).toEqual({
            sessionId: 'remote-session',
            messages: [{ role: 'assistant', content: 'remote-hi' }],
        });
    });
});

describe('terminal runtime helpers', () => {
    it('lists sessions from local and remote runtimes', async () => {
        const localList = await listTerminalSessions(createRuntime(), '/project', 5);
        const remoteList = await listTerminalSessions(createRemoteRuntime(), '/project', 5);

        expect(localList).toEqual([]);
        expect(remoteList).toEqual([{ id: 'remote-session', title: 'Remote Session' }]);
    });

    it('creates sessions only in attach mode', async () => {
        await expect(createTerminalSession(createRuntime(), '/project')).rejects.toThrow(
            'Session creation is only supported in attach mode',
        );

        await expect(createTerminalSession(createRemoteRuntime(), '/project', 'Fresh Remote Session')).resolves.toEqual({
            id: 'created-remote-session',
            title: 'Fresh Remote Session',
        });
    });

    it('loads session history from local and remote runtimes', async () => {
        const local = await loadTerminalSessionHistory(createRuntime(), 'session-latest');
        const remote = await loadTerminalSessionHistory(createRemoteRuntime(), 'remote-session');

        expect(local).toEqual({
            sessionId: 'session-latest',
            title: 'Latest Session',
            cwd: '/project',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(remote).toEqual({
            sessionId: 'remote-session',
            messages: [{ role: 'assistant', content: 'remote-hi' }],
        });
    });

    it('disposes the agent service and closes the local session store', async () => {
        let disposed = false;
        let closed = false;
        const runtime: TerminalAgentRuntime = {
            agentService: {
                isBusy: false,
                cancel() {},
                async compactSession() { return null; },
                async sendMessage() {
                    return { sessionId: 'session-latest', response: '' };
                },
                async dispose() {
                    disposed = true;
                },
            },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                getSessionSummary: () => null,
                listSessions: () => [],
                close() {
                    closed = true;
                },
            },
        };

        await disposeTerminalAgentRuntime(runtime);

        expect(disposed).toBe(true);
        expect(closed).toBe(true);
    });
});
