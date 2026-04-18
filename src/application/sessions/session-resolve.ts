import type {
    SessionDetail,
    SessionLookupPort,
    SessionSummary,
} from './ports.js';

export interface ResolvedSession {
    session: SessionDetail;
    summary: SessionSummary;
}

export interface ResolvedSessionForTui {
    sessionId: string;
    title?: string;
}

export function resolveSessionForExport(
    sessionStore: SessionLookupPort,
    sessionId: string | undefined,
    projectRoot: string,
): ResolvedSession {
    const session = sessionId
        ? sessionStore.getSession(sessionId)
        : sessionStore.findLatestSession(projectRoot);

    if (!session) {
        throw new Error(sessionId
            ? `Specified session not found: ${sessionId}`
            : `Project ${projectRoot} has no exportable session yet`);
    }

    const summary = sessionStore.getSessionSummary(session.id);
    if (!summary) {
        throw new Error(`Unable to read session summary: ${session.id}`);
    }

    return { session, summary };
}

export function resolveSessionForTui(
    sessionStore: SessionLookupPort,
    projectRoot: string,
    sessionIdOrLatest?: string,
): ResolvedSessionForTui | null {
    const id = sessionIdOrLatest === 'latest' || !sessionIdOrLatest
        ? sessionStore.findLatestSession(projectRoot)?.id
        : sessionIdOrLatest;

    if (!id) {
        return null;
    }

    const session = sessionStore.getSession(id);
    if (!session) {
        return null;
    }

    const summary = sessionStore.getSessionSummary(id);
    return {
        sessionId: id,
        ...(summary?.title !== undefined ? { title: summary.title } : {}),
    };
}
