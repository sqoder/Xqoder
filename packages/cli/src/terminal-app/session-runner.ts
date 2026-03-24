import { type AgentSession, type PersistedSessionSummary } from '@xqoder/agent';
import type { TerminalAppState } from '../terminal-core/app-state.js';
import type { TerminalEventLoop } from '../terminal-core/event-loop.js';
import {
    createRuntimeSessionResolveStoreAdapter,
    listResolvedSessionSummaries,
    resolveSessionById,
    resolveSessionForTui,
} from '../services/session-resolve.js';
import type { LocalTuiSessionStore, RemoteTuiAgentService, TuiAgentSettings, TuiAgentService } from '../tui/agent-service.js';

type SessionRunnerEventLoop = Pick<TerminalEventLoop<TerminalAppState>, 'dispatch'>;
type RemoteSessionService = Pick<RemoteTuiAgentService, 'getSessionMessages' | 'listSessions'>;

export interface InitialTerminalSessionResolution {
    restoredSessionId: string | undefined;
    restoredSession: AgentSession | null;
    restoredSummary: PersistedSessionSummary | null;
}

export function createLocalSessionResolveStore(
    sessionStore: LocalTuiSessionStore,
    settings: TuiAgentSettings,
    projectRoot = settings.dir,
) {
    return createRuntimeSessionResolveStoreAdapter(sessionStore, {
        projectRoot,
        cwd: projectRoot,
        model: settings.model,
    });
}

export async function listLocalResolvedSessions(
    sessionStore: LocalTuiSessionStore,
    projectRoot: string,
    settings: TuiAgentSettings,
    limit: number,
) {
    return await listResolvedSessionSummaries(
        createLocalSessionResolveStore(sessionStore, settings, projectRoot),
        projectRoot,
        limit,
    );
}

export async function resolveLocalSession(
    sessionStore: LocalTuiSessionStore,
    settings: TuiAgentSettings,
    sessionId: string,
) {
    return await resolveSessionById(
        createLocalSessionResolveStore(sessionStore, settings),
        sessionId,
    );
}

export async function resolveLocalSessionForTui(
    sessionStore: LocalTuiSessionStore,
    settings: TuiAgentSettings,
    sessionIdOrLatest?: string,
) {
    const runtimeStore = createLocalSessionResolveStore(sessionStore, settings);
    const target = await resolveSessionForTui(runtimeStore, settings.dir, sessionIdOrLatest);
    if (!target) {
        return null;
    }
    const resolved = await resolveSessionById(runtimeStore, target.sessionId);
    if (!resolved) {
        return null;
    }
    return {
        sessionId: target.sessionId,
        session: resolved.session,
        summary: resolved.summary,
    };
}

function setNotice(eventLoop: SessionRunnerEventLoop, notice: string): void {
    eventLoop.dispatch({ type: 'notice.set', notice });
}

export async function resolveInitialTerminalSession(
    options: {
        agentService: TuiAgentService | RemoteSessionService;
        attachBaseUrl?: string;
        sessionStore: LocalTuiSessionStore | null;
        settings: TuiAgentSettings;
        session?: string;
        continue?: boolean;
    },
): Promise<InitialTerminalSessionResolution> {
    if (options.attachBaseUrl) {
        const remote = options.agentService as RemoteSessionService;
        const list = await remote.listSessions(options.settings.dir, 1);
        return {
            restoredSessionId: list[0]?.id,
            restoredSession: null,
            restoredSummary: null,
        };
    }

    const restoreTarget = options.session ?? (options.continue ? 'latest' : undefined);
    if (!restoreTarget || !options.sessionStore) {
        return {
            restoredSessionId: undefined,
            restoredSession: null,
            restoredSummary: null,
        };
    }

    const resolvedSession = await resolveLocalSessionForTui(
        options.sessionStore,
        options.settings,
        restoreTarget,
    );

    return {
        restoredSessionId: resolvedSession?.sessionId,
        restoredSession: resolvedSession?.session ?? null,
        restoredSummary: resolvedSession?.summary ?? null,
    };
}

export async function restoreSelectedTerminalSession(
    sessionId: string,
    sessionTitle: string | undefined,
    eventLoop: SessionRunnerEventLoop,
    options: {
        agentService: TuiAgentService | RemoteSessionService;
        attachBaseUrl?: string;
        sessionStore: LocalTuiSessionStore | null;
        settings: TuiAgentSettings;
        setActiveSessionId: (sessionId: string | undefined) => void;
    },
): Promise<void> {
    try {
        if (options.attachBaseUrl) {
            const remote = options.agentService as RemoteSessionService;
            const data = await remote.getSessionMessages(sessionId);
            options.setActiveSessionId(sessionId);
            eventLoop.dispatch({
                type: 'session.restored',
                sessionId,
                messages: data.messages,
            });
            setNotice(eventLoop, `Session: ${sessionTitle ?? sessionId}`);
            return;
        }

        if (!options.sessionStore) {
            return;
        }

        const resolved = await resolveLocalSession(options.sessionStore, options.settings, sessionId);
        if (!resolved) {
            return;
        }

        options.setActiveSessionId(sessionId);
        eventLoop.dispatch({
            type: 'session.restored',
            sessionId,
            title: resolved.summary.title,
            cwd: resolved.summary.cwd,
            messages: resolved.session.getMessages(),
        });
        setNotice(eventLoop, `Session: ${resolved.summary.title}`);
    } catch (err) {
        setNotice(eventLoop, err instanceof Error ? err.message : String(err));
    }
}
