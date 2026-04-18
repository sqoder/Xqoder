import {
    getXQoderPaths,
    type LLMMessage,
} from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/storage-sqlite';
import {
    hasAgentSessionBrowserPort,
    type AgentConversationPort,
    type AgentSessionListEntry,
    type TuiAgentSettings,
} from '../../../application/agent/index.js';
import {
    RemoteTuiAgentService,
    TuiAgentService,
} from '../../../infrastructure/agent/index.js';

interface TerminalSessionDetail {
    id: string;
    getMessages(): LLMMessage[];
}

interface TerminalSessionSummary {
    id: string;
    title: string;
    cwd: string;
}

export interface TerminalSessionStore {
    findLatestSession(projectRoot: string): TerminalSessionDetail | null;
    getSession(sessionId: string): TerminalSessionDetail | null;
    getSessionSummary(sessionId: string): TerminalSessionSummary | null;
    listSessions(projectRoot?: string, limit?: number): Array<{ id: string; title: string }>;
    close(): void;
}

export interface TerminalAgentRuntime {
    attachBaseUrl?: string;
    agentService: AgentConversationPort;
    sessionStore: TerminalSessionStore | null;
}

export interface TerminalAgentRuntimeOptions {
    attachBaseUrl?: string;
    serverPassword?: string;
    serverUsername?: string;
}

export interface TerminalSessionSnapshot {
    sessionId: string;
    title?: string;
    cwd?: string;
    messages: LLMMessage[];
}

export function createTerminalAgentRuntime(
    options: TerminalAgentRuntimeOptions,
): TerminalAgentRuntime {
    const attachBaseUrl = options.attachBaseUrl?.replace(/\/$/, '');
    const sessionStore = attachBaseUrl
        ? null
        : new SQLiteSessionStore(getXQoderPaths().sessionDbFile);

    const agentService = attachBaseUrl
        ? new RemoteTuiAgentService(
            attachBaseUrl,
            options.serverPassword
                ? {
                    username: options.serverUsername ?? 'xqoder',
                    password: options.serverPassword,
                }
                : undefined,
        )
        : new TuiAgentService(sessionStore!);

    return {
        attachBaseUrl,
        agentService,
        sessionStore,
    };
}

export async function restoreTerminalAgentSession(
    runtime: TerminalAgentRuntime,
    settings: TuiAgentSettings,
    options: { continue?: boolean; session?: string },
): Promise<TerminalSessionSnapshot | undefined> {
    if (hasAgentSessionBrowserPort(runtime.agentService)) {
        const sessionId = options.session?.trim()
            || (await runtime.agentService.listSessions(settings.dir, 1))[0]?.id;
        return sessionId
            ? await loadTerminalSessionHistory(runtime, sessionId)
            : undefined;
    }

    const restoreTarget = options.session ?? (options.continue ? 'latest' : undefined);
    if (!restoreTarget || !runtime.sessionStore) {
        return undefined;
    }

    const sessionId = restoreTarget === 'latest'
        ? runtime.sessionStore.findLatestSession(settings.dir)?.id
        : restoreTarget;

    return sessionId
        ? loadLocalSessionHistory(runtime.sessionStore, sessionId)
        : undefined;
}

export async function listTerminalSessions(
    runtime: TerminalAgentRuntime,
    projectRoot: string,
    limit: number,
): Promise<Array<{ id: string; title: string }>> {
    if (hasAgentSessionBrowserPort(runtime.agentService)) {
        const list = await runtime.agentService.listSessions(projectRoot, limit);
        return list.map(toTerminalSessionListEntry);
    }

    return runtime.sessionStore?.listSessions(projectRoot, limit).map(toTerminalSessionListEntry) ?? [];
}

export async function createTerminalSession(
    runtime: TerminalAgentRuntime,
    projectRoot: string,
    title?: string,
): Promise<{ id: string; title: string }> {
    if (!hasAgentSessionBrowserPort(runtime.agentService)) {
        throw new Error('Session creation is only supported in attach mode');
    }

    return runtime.agentService.createSession(projectRoot, title);
}

export async function loadTerminalSessionHistory(
    runtime: TerminalAgentRuntime,
    sessionId: string,
): Promise<TerminalSessionSnapshot | undefined> {
    if (hasAgentSessionBrowserPort(runtime.agentService)) {
        const data = await runtime.agentService.getSessionMessages(sessionId);
        return {
            sessionId,
            messages: data.messages,
        };
    }

    if (!runtime.sessionStore) {
        return undefined;
    }

    return loadLocalSessionHistory(runtime.sessionStore, sessionId);
}

export async function disposeTerminalAgentRuntime(runtime: TerminalAgentRuntime): Promise<void> {
    await runtime.agentService.dispose();
    runtime.sessionStore?.close();
}

function loadLocalSessionHistory(
    sessionStore: TerminalSessionStore,
    sessionId: string,
): TerminalSessionSnapshot | undefined {
    const session = sessionStore.getSession(sessionId);
    const summary = sessionStore.getSessionSummary(sessionId);
    if (!session) {
        return undefined;
    }

    return {
        sessionId: session.id,
        title: summary?.title,
        cwd: summary?.cwd,
        messages: session.getMessages(),
    };
}

function toTerminalSessionListEntry<T extends Pick<AgentSessionListEntry, 'id' | 'title'> | { id: string; title: string }>(
    session: T,
): { id: string; title: string } {
    return {
        id: session.id,
        title: session.title || session.id,
    };
}
