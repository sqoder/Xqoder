/**
 * Session 解析服务（Day 43 迁出 TUI 的业务逻辑）
 * 供 TUI 初始加载/恢复与 CLI export/share 共用，避免在 app 内重复 findLatestSession/getSession。
 */
import type {
    AgentSessionStore,
    PersistedSessionSummary,
    AgentSession,
} from '@xqoder/storage-sqlite';

export interface ResolvedSession {
    session: AgentSession;
    summary: PersistedSessionSummary;
}

export interface ResolvedSessionForTui {
    sessionId: string;
    title?: string;
}

/**
 * 解析 session：若指定 sessionId 则取该会话，否则取项目最近一次。
 * 未找到时抛出。
 */
export function resolveSessionForExport(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary'>,
    sessionId: string | undefined,
    projectRoot: string,
): ResolvedSession {
    const session = sessionId
        ? sessionStore.getSession(sessionId)
        : sessionStore.findLatestSession(projectRoot);

    if (!session) {
        throw new Error(sessionId
            ? `未找到指定 session: ${sessionId}`
            : `项目 ${projectRoot} 还没有可导出的 session`);
    }

    const summary = sessionStore.getSessionSummary(session.id);
    if (!summary) {
        throw new Error(`无法读取 session 摘要: ${session.id}`);
    }

    return { session, summary };
}

/**
 * 解析 session 用于 TUI 展示（初始加载或 resume）：返回 sessionId + title，未找到返回 null。
 */
export function resolveSessionForTui(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary'>,
    projectRoot: string,
    sessionIdOrLatest?: string,
): ResolvedSessionForTui | null {
    const id = sessionIdOrLatest === 'latest' || !sessionIdOrLatest
        ? sessionStore.findLatestSession(projectRoot)?.id
        : sessionIdOrLatest;

    if (!id) return null;

    const session = sessionStore.getSession(id);
    if (!session) return null;

    const summary = sessionStore.getSessionSummary(id);
    return {
        sessionId: id,
        title: summary?.title,
    };
}
