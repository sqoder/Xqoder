import type {
    AgentSessionStore,
    PersistedSessionSummary,
} from '@xqoder/storage-sqlite';
import {
    formatSessionShareDetail,
    formatSessionShareListLine,
    renderSessionMarkdown,
    type SessionShareDetails,
    type SessionShareRecord,
    type SessionShareStore,
} from '../session-assets.js';
import { formatSessionDetail, formatSessionListLine } from '../commands/sessions.js';

export interface TuiSessionListResult {
    sessions: PersistedSessionSummary[];
    lines: string[];
}

export interface TuiSessionResumeResult {
    sessionId: string;
    title: string;
    detail: string;
    lines: string[];
}

export interface TuiActionFeedback {
    infoMessage: string;
    systemMessage?: string;
}

export interface TuiShareResult {
    lines: string[];
}

export function buildTuiActionFeedback(
    action:
        | 'copy'
        | 'copy_session'
        | 'copy_code'
        | 'export_md'
        | 'share_create'
        | 'share_remove'
        | 'unshare',
    metadata: {
        count?: number;
        id?: string;
        target?: string;
        enabled?: boolean;
    } = {},
): TuiActionFeedback {
    switch (action) {
        case 'copy':
            return {
                infoMessage: 'Copy → latest response',
                systemMessage: 'Copied latest AI response to clipboard.',
            };
        case 'copy_session':
            return {
                infoMessage: 'Copy → session',
                systemMessage: `Copied session transcript to clipboard (${metadata.count ?? 0} chat messages).`,
            };
        case 'copy_code':
            return {
                infoMessage: `Copy → code (${metadata.count ?? 0})`,
                systemMessage: `Copied ${metadata.count ?? 0} code block(s) to clipboard.`,
            };
        case 'export_md':
            return {
                infoMessage: `Export → ${metadata.target ?? 'session.md'}`,
                systemMessage: `Exported current session as Markdown: ${metadata.target ?? 'session.md'}`,
            };
        case 'share_create':
            return {
                infoMessage: `Share → ${metadata.id ?? 'created'}`,
                systemMessage: `Created local share ${metadata.id ?? ''}.`.trim(),
            };
        case 'share_remove':
            return {
                infoMessage: `Share removed → ${metadata.id ?? 'done'}`,
                systemMessage: `Removed local share ${metadata.id ?? ''}.`.trim(),
            };
        case 'unshare':
            return {
                infoMessage: `Unshare → ${metadata.count ?? 0} removed`,
                systemMessage: `Removed ${metadata.count ?? 0} local share(s) linked to the current session.`,
            };
    }
}

export function buildTuiSessionList(
    sessionStore: Pick<AgentSessionStore, 'listSessions'>,
    projectRoot: string,
    activeSessionId?: string,
    limit: number = 8,
): TuiSessionListResult {
    const sessions = sessionStore.listSessions(projectRoot, limit);
    if (sessions.length === 0) {
        return {
            sessions: [],
            lines: [
                `项目 ${projectRoot} 还没有持久化 session。`,
            ],
        };
    }

    return {
        sessions,
        lines: [
            `项目 ${projectRoot} 的最近 ${sessions.length} 条 session:`,
            ...sessions.map((summary, index) => (
                `${summary.id === activeSessionId ? '* ' : '- '}[${index + 1}] ${formatSessionListLine(summary).replace(/^- /, '')}`
            )),
            '',
            '使用 /resume <编号> 或 /resume <sessionId> 在 TUI 内切换会话。',
        ],
    };
}

export function buildTuiSessionDetail(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary' | 'listSessions'>,
    projectRoot: string,
    sessionSelector?: string,
    transcriptLimit: number = 10,
    historyLimit: number = 8,
): TuiSessionResumeResult {
    const resolvedSessionId = resolveSessionSelector(sessionStore, projectRoot, sessionSelector);
    const session = resolvedSessionId
        ? sessionStore.getSession(resolvedSessionId)
        : sessionStore.findLatestSession(projectRoot);

    if (!session) {
        throw new Error(sessionSelector
            ? `未找到指定 session: ${sessionSelector}`
            : `项目 ${projectRoot} 还没有可恢复的 session`);
    }

    const summary = sessionStore.getSessionSummary(session.id);
    if (!summary) {
        throw new Error(`无法读取 session 摘要: ${session.id}`);
    }

    const detail = formatSessionDetail(summary, session, transcriptLimit, historyLimit);
    return {
        sessionId: summary.id,
        title: summary.title,
        detail,
        lines: [
            ...detail.split('\n'),
            '',
            'TUI: use /details to toggle tool execution details and /diff to inspect file changes.',
        ],
    };
}

export function buildTuiResumeResult(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary' | 'listSessions'>,
    projectRoot: string,
    activeSessionId?: string,
    requestedSessionSelector?: string,
): TuiSessionResumeResult {
    const preferredSessionId = requestedSessionSelector ?? activeSessionId;
    const detail = buildTuiSessionDetail(
        sessionStore,
        projectRoot,
        preferredSessionId,
    );

    return {
        ...detail,
        lines: [
            `已切换当前会话: ${detail.sessionId}`,
            `Title: ${detail.title}`,
            '',
            ...detail.lines,
        ],
    };
}

export function buildTuiShareCreateResult(
    sessionStore: Pick<AgentSessionStore, 'findLatestSession' | 'getSession' | 'getSessionSummary' | 'listSessions'>,
    shareStore: SessionShareStore,
    projectRoot: string,
    activeSessionId?: string,
    requestedSessionSelector?: string,
): {
    share: SessionShareRecord;
    lines: string[];
} {
    const preferredSessionId = requestedSessionSelector ?? activeSessionId;
    const detail = buildTuiSessionDetail(
        sessionStore,
        projectRoot,
        preferredSessionId,
    );
    const session = preferredSessionId
        ? sessionStore.getSession(detail.sessionId)
        : sessionStore.findLatestSession(projectRoot);
    const summary = sessionStore.getSessionSummary(detail.sessionId);

    if (!session || !summary) {
        throw new Error(`无法读取会话以创建 share: ${detail.sessionId}`);
    }

    const share = shareStore.createShare({
        sessionId: summary.id,
        projectRoot: summary.projectRoot,
        title: summary.title,
        format: 'markdown',
        content: renderSessionMarkdown(summary, session),
    });

    return {
        share,
        lines: [
            `已为当前会话创建本地 share: ${share.id}`,
            `Artifact: ${share.artifactPath}`,
            `Session: ${share.sessionId}`,
        ],
    };
}

function resolveSessionSelector(
    sessionStore: Pick<AgentSessionStore, 'listSessions' | 'getSession'>,
    projectRoot: string,
    sessionSelector?: string,
): string | undefined {
    if (!sessionSelector) {
        return undefined;
    }

    const numericIndex = Number.parseInt(sessionSelector, 10);
    if (Number.isInteger(numericIndex) && String(numericIndex) === sessionSelector && numericIndex > 0) {
        const sessions = sessionStore.listSessions(projectRoot, Math.max(numericIndex, 20));
        return sessions[numericIndex - 1]?.id;
    }

    return sessionStore.getSession(sessionSelector)
        ? sessionSelector
        : undefined;
}

export function buildTuiShareList(
    shareStore: SessionShareStore,
    projectRoot: string,
    limit: number = 8,
): TuiShareResult {
    const shares = shareStore.listShares(projectRoot, limit);
    if (shares.length === 0) {
        return {
            lines: [
                `项目 ${projectRoot} 还没有本地 share。`,
            ],
        };
    }

    return {
        lines: [
            `项目 ${projectRoot} 的最近 ${shares.length} 个本地 share:`,
            ...shares.map(formatSessionShareListLine),
            '',
            '使用 /share show <id> 查看详情，或 /share remove <id> 删除本地 share。',
        ],
    };
}

export function buildTuiShareShow(
    shareStore: SessionShareStore,
    shareId: string,
): {
    share: SessionShareDetails;
    lines: string[];
} {
    const share = shareStore.getShare(shareId);
    if (!share) {
        throw new Error(`未找到指定 share: ${shareId}`);
    }

    return {
        share,
        lines: [
            ...formatSessionShareDetail(share).split('\n'),
            '',
            `使用 /share remove ${share.id} 删除该本地 share。`,
        ],
    };
}

export function buildTuiShareRemove(
    shareStore: SessionShareStore,
    shareId: string,
): {
    share: SessionShareRecord;
    lines: string[];
} {
    const share = shareStore.removeShare(shareId);
    if (!share) {
        throw new Error(`未找到指定 share: ${shareId}`);
    }

    return {
        share,
        lines: [
            `已删除本地 share: ${share.id}`,
            `Artifact: ${share.artifactPath}`,
            '',
            '使用 /share list 查看剩余本地 share。',
        ],
    };
}
