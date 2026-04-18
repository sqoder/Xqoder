export interface SessionUsageSummary {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface SessionSummary {
    id: string;
    projectRoot: string;
    cwd: string;
    model: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    maxMessages: number;
    messageCount: number;
    usage: SessionUsageSummary;
    lastUserMessage?: string;
    compactionCount: number;
    commandCount: number;
    fileChangeCount: number;
}

export interface SessionMessageView {
    role: string;
    content: string;
}

export interface SessionCommandHistoryEntry {
    completedAt: Date;
    success: boolean;
    command: string;
}

export interface SessionFileChangeEntry {
    timestamp: Date;
    changeType: 'write' | 'patch' | 'restore';
    success: boolean;
    path: string;
    bytes: number;
}

export interface SessionToolHistoryEntry {
    completedAt: Date;
    success: boolean;
    name: string;
    args: unknown;
    outputPreview: string;
}

export interface SessionDetail {
    id: string;
    getMessages(): SessionMessageView[];
    getCommandHistory(): SessionCommandHistoryEntry[];
    getFileChanges(): SessionFileChangeEntry[];
    getToolHistory(): SessionToolHistoryEntry[];
    getCompactSummary(): string | undefined;
}

export interface SessionLookupPort {
    findLatestSession(projectRoot: string): SessionDetail | null;
    getSession(sessionId: string): SessionDetail | null;
    getSessionSummary(sessionId: string): SessionSummary | null;
}

export interface SessionListPort extends SessionLookupPort {
    listSessions(projectRoot?: string, limit?: number): SessionSummary[];
}
