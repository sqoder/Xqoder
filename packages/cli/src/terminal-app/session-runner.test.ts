import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { TerminalEventLoop } from '../terminal-core/event-loop.js';
import { reduceTerminalAppState } from './reducer.js';
import {
    resolveInitialTerminalSession,
    restoreSelectedTerminalSession,
} from './session-runner.js';
import {
    resolveSessionById,
    resolveSessionForTui,
} from '../services/session-resolve.js';

vi.mock('../services/session-resolve.js', () => ({
    createRuntimeSessionResolveStoreAdapter: vi.fn(() => ({})),
    listResolvedSessionSummaries: vi.fn(),
    resolveSessionById: vi.fn(),
    resolveSessionForExport: vi.fn(),
    resolveSessionForTui: vi.fn(),
}));

function createEventLoop() {
    return new TerminalEventLoop({
        initialState: createInitialTerminalAppState({ width: 100, height: 30 }, { cwd: '/repo' }),
        reduce: reduceTerminalAppState,
        render: () => {},
    });
}

function createSession() {
    return AgentSession.fromSnapshot({
        id: 'session-local',
        title: 'Local Session',
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        maxMessages: 100,
        messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' },
        ],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        metadata: {
            compactions: [],
            toolHistory: [],
            commandHistory: [],
            fileChanges: [],
        },
    });
}

function createSummary() {
    return {
        id: 'session-local',
        title: 'Local Session',
        projectRoot: '/repo',
        cwd: '/repo',
        model: 'gpt-4o',
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
        maxMessages: 100,
        messageCount: 2,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        compactionCount: 0,
        commandCount: 0,
        fileChangeCount: 0,
    };
}

describe('session runner', () => {
    it('resolves the latest remote session during initial terminal restore', async () => {
        const remote = {
            listSessions: vi.fn().mockResolvedValue([
                { id: 'remote-1', title: 'Remote Session', updatedAt: '2026-03-24T00:00:00.000Z' },
            ]),
        };

        const result = await resolveInitialTerminalSession({
            agentService: remote as any,
            attachBaseUrl: 'http://localhost:3000',
            sessionStore: null,
            settings: {
                dir: '/repo',
                model: 'gpt-4o',
                agent: 'general',
                sandboxMode: 'full-access',
            },
        });

        expect(remote.listSessions).toHaveBeenCalledWith('/repo', 1);
        expect(result).toEqual({
            restoredSessionId: 'remote-1',
            restoredSession: null,
            restoredSummary: null,
        });
    });

    it('resolves the latest local session during initial terminal restore', async () => {
        const session = createSession();
        const summary = createSummary();
        vi.mocked(resolveSessionForTui).mockResolvedValue({
            sessionId: 'session-local',
            title: 'Local Session',
        });
        vi.mocked(resolveSessionById).mockResolvedValue({
            session,
            summary,
        });

        const result = await resolveInitialTerminalSession({
            agentService: {} as any,
            sessionStore: {} as any,
            settings: {
                dir: '/repo',
                model: 'gpt-4o',
                agent: 'general',
                sandboxMode: 'full-access',
            },
            continue: true,
        });

        expect(result.restoredSessionId).toBe('session-local');
        expect(result.restoredSession).toBe(session);
        expect(result.restoredSummary).toBe(summary);
    });

    it('restores a selected local session through the extracted runner', async () => {
        const session = createSession();
        const summary = createSummary();
        vi.mocked(resolveSessionById).mockResolvedValue({
            session,
            summary,
        });
        const eventLoop = createEventLoop();
        let activeSessionId: string | undefined;

        await restoreSelectedTerminalSession('session-local', 'Local Session', eventLoop, {
            agentService: {} as any,
            sessionStore: {} as any,
            settings: {
                dir: '/repo',
                model: 'gpt-4o',
                agent: 'general',
                sandboxMode: 'full-access',
            },
            setActiveSessionId: (sessionId) => {
                activeSessionId = sessionId;
            },
        });

        expect(activeSessionId).toBe('session-local');
        expect(eventLoop.getState().activeSessionId).toBe('session-local');
        expect(eventLoop.getState().notice).toBe('Session: Local Session');
        expect(eventLoop.getState().transcriptEntries).toHaveLength(2);
        expect(eventLoop.getState().transcriptEntries[0]?.content).toBe('hello');
    });
});
