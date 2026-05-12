import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    AgentSession,
    normalizeSessionMetadataSnapshot,
    type AgentSessionMetadataSnapshot,
    type AgentSessionUsage,
} from './session.js';
import { runMigrations } from './migrations.js';
import {
    readOptionalSessionUsage,
    serializeOptionalSessionUsage,
} from './session-usage.js';
import { sanitizeForPersistence, sanitizeMessageForPersistence } from './sanitize.js';
import {
    createSqliteDatabase,
    type SqliteDatabase,
} from './sqlite-runtime.js';

export interface PersistedSessionSummary {
    id: string;
    projectRoot: string;
    cwd: string;
    model: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    maxMessages: number;
    messageCount: number;
    usage: AgentSessionUsage;
    lastUserMessage?: string;
    compactionCount: number;
    commandCount: number;
    fileChangeCount: number;
    /** P24 — permission mode at time of save */
    permissionMode?: string;
    /** P24 — activated skill names */
    activatedSkills: string[];
    /** P24 — parent session id when this is a rewind branch */
    parentSessionId?: string;
}

export interface SaveSessionOptions {
    /** Whether to persist last_user_message. Default is true; set to false to prevent sensitive content from being written to disk. */
    persistLastUserMessage?: boolean;
}

export interface SaveSessionInput {
    session: AgentSession;
    projectRoot: string;
    cwd: string;
    model: string;
    title?: string;
    options?: SaveSessionOptions;
    /** P24 — permission mode to persist */
    permissionMode?: string;
    /** P24 — activated skill names to persist */
    activatedSkills?: string[];
    /** P24 — parent session id for rewind branches */
    parentSessionId?: string;
}

export interface AgentSessionStore {
    getSession(sessionId: string): AgentSession | null;
    getSessionSummary(sessionId: string): PersistedSessionSummary | null;
    findLatestSession(projectRoot: string): AgentSession | null;
    listSessions(projectRoot?: string, limit?: number): PersistedSessionSummary[];
    saveSession(input: SaveSessionInput): PersistedSessionSummary;
    updateSessionTitle(sessionId: string, title: string): PersistedSessionSummary;
    createEmptySession(projectRoot: string, model: string, title?: string): PersistedSessionSummary;
    deleteSession(sessionId: string): void;
    close(): void;
}

export class SQLiteSessionStore implements AgentSessionStore {
    private readonly db: SqliteDatabase;

    constructor(dbPath: string) {
        const resolvedDbPath = path.resolve(dbPath);
        const dbDir = path.dirname(resolvedDbPath);

        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = createSqliteDatabase(resolvedDbPath);
        this.db.exec('PRAGMA foreign_keys = ON;');
        ensureSessionSchema(this.db);
        runMigrations(this.db);
    }

    getSession(sessionId: string): AgentSession | null {
        const row = this.getSessionRow(sessionId);
        if (!row) {
            return null;
        }

        const rows = this.db.prepare(`
            SELECT message_json
            FROM session_messages
            WHERE session_id = ?
            ORDER BY seq ASC
        `).all(sessionId) as Array<{ message_json: string }>;
        const parsed = parseSessionRow(row);

        return AgentSession.fromSnapshot({
            id: parsed.summary.id,
            title: parsed.summary.title,
            createdAt: parsed.summary.createdAt,
            maxMessages: parsed.summary.maxMessages,
            messages: rows.map((entry) => JSON.parse(entry.message_json)),
            usage: parsed.summary.usage,
            metadata: parsed.metadata,
        });
    }

    getSessionSummary(sessionId: string): PersistedSessionSummary | null {
        const row = this.getSessionRow(sessionId);
        if (!row) {
            return null;
        }

        return parseSessionRow(row).summary;
    }

    findLatestSession(projectRoot: string): AgentSession | null {
        const row = this.db.prepare(`
            SELECT id
            FROM sessions
            WHERE project_root = ?
            ORDER BY updated_at DESC, rowid DESC
            LIMIT 1
        `).get(path.resolve(projectRoot)) as { id: string } | undefined;

        if (!row) {
            return null;
        }

        return this.getSession(row.id);
    }

    listSessions(projectRoot?: string, limit: number = 20): PersistedSessionSummary[] {
        const resolvedLimit = Math.max(1, limit);
        const rows = projectRoot
            ? this.db.prepare(`
                SELECT *
                FROM sessions
                WHERE project_root = ?
                ORDER BY updated_at DESC, rowid DESC
                LIMIT ?
            `).all(path.resolve(projectRoot), resolvedLimit)
            : this.db.prepare(`
                SELECT *
                FROM sessions
                ORDER BY updated_at DESC, rowid DESC
                LIMIT ?
            `).all(resolvedLimit);

        return (rows as SessionRow[]).map((row) => parseSessionRow(row).summary);
    }

    saveSession(input: SaveSessionInput): PersistedSessionSummary {
        const snapshot = input.session.toSnapshot();
        const projectRoot = path.resolve(input.projectRoot);
        const cwd = path.resolve(input.cwd);
        const now = new Date().toISOString();
        const title = input.title?.trim() || snapshot.title?.trim() || deriveSessionTitle(snapshot.messages, projectRoot);
        const rawLastUserMessage = findLastUserMessage(snapshot.messages);
        const persistLastUserMessage = input.options?.persistLastUserMessage !== false;
        const lastUserMessageForDb =
            persistLastUserMessage && rawLastUserMessage != null
                ? sanitizeForPersistence(rawLastUserMessage)
                : null;

        try {
            this.db.exec('BEGIN IMMEDIATE;');
            this.db.prepare(`
                INSERT INTO sessions (
                    id,
                    project_root,
                    cwd,
                    model,
                    title,
                    created_at,
                    updated_at,
                    max_messages,
                    message_count,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    last_user_message,
                    session_metadata_json,
                    permission_mode,
                    activated_skills,
                    parent_session_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_root = excluded.project_root,
                    cwd = excluded.cwd,
                    model = excluded.model,
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    max_messages = excluded.max_messages,
                    message_count = excluded.message_count,
                    prompt_tokens = excluded.prompt_tokens,
                    completion_tokens = excluded.completion_tokens,
                    total_tokens = excluded.total_tokens,
                    last_user_message = excluded.last_user_message,
                    session_metadata_json = excluded.session_metadata_json,
                    permission_mode = excluded.permission_mode,
                    activated_skills = excluded.activated_skills,
                    parent_session_id = excluded.parent_session_id
            `).run(
                snapshot.id,
                projectRoot,
                cwd,
                input.model,
                title,
                snapshot.createdAt.toISOString(),
                now,
                snapshot.maxMessages,
                snapshot.messages.length,
                snapshot.usage.promptTokens,
                snapshot.usage.completionTokens,
                snapshot.usage.totalTokens,
                lastUserMessageForDb,
                JSON.stringify({
                    ...snapshot.metadata,
                    usage: serializeOptionalSessionUsage(snapshot.usage),
                }),
                input.permissionMode ?? null,
                JSON.stringify(input.activatedSkills ?? []),
                input.parentSessionId ?? null,
            );

            this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(snapshot.id);
            const insertMessage = this.db.prepare(`
                INSERT INTO session_messages (
                    session_id,
                    seq,
                    message_json
                ) VALUES (?, ?, ?)
            `);

            snapshot.messages.forEach((message, index) => {
                const sanitized = sanitizeMessageForPersistence(message as any);
                insertMessage.run(snapshot.id, index, JSON.stringify(sanitized));
            });

            this.db.exec('COMMIT;');
        } catch (err) {
            safeRollback(this.db);
            throw err;
        }

        const summary = this.getSessionSummary(snapshot.id);
        if (!summary) {
            throw new Error(`Unable to reload saved session: ${snapshot.id}`);
        }

        return summary;
    }

    updateSessionTitle(sessionId: string, title: string): PersistedSessionSummary {
        const normalizedTitle = title.trim();
        if (!normalizedTitle) {
            throw new Error('session title cannot be empty');
        }

        const existing = this.getSessionRow(sessionId);
        if (!existing) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        this.db.prepare(`
            UPDATE sessions
            SET title = ?, updated_at = ?
            WHERE id = ?
        `).run(normalizedTitle, new Date().toISOString(), sessionId);

        const summary = this.getSessionSummary(sessionId);
        if (!summary) {
            throw new Error(`Unable to reload session after title update: ${sessionId}`);
        }

        return summary;
    }

    createEmptySession(projectRoot: string, model: string, title?: string): PersistedSessionSummary {
        const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        const resolvedRoot = path.resolve(projectRoot);
        const sessionTitle = title ?? 'New Session';

        this.db.prepare(`
            INSERT INTO sessions
                (id, project_root, cwd, model, title, created_at, updated_at,
                 max_messages, message_count, prompt_tokens, completion_tokens,
                 total_tokens, last_user_message, session_metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, 100, 0, 0, 0, 0, NULL, '{}')
        `).run(id, resolvedRoot, resolvedRoot, model, sessionTitle, now, now);

        const nowDate = new Date(now);
        return {
            id,
            projectRoot: resolvedRoot,
            cwd: resolvedRoot,
            model,
            title: sessionTitle,
            createdAt: nowDate,
            updatedAt: nowDate,
            maxMessages: 100,
            messageCount: 0,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
            activatedSkills: [],
        };
    }

    deleteSession(sessionId: string): void {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    }

    close(): void {
        this.db.close();
    }

    private getSessionRow(sessionId: string): SessionRow | null {
        const row = this.db.prepare(`
            SELECT *
            FROM sessions
            WHERE id = ?
        `).get(sessionId) as SessionRow | undefined;

        return row ?? null;
    }
}

interface SessionRow {
    id: string;
    project_root: string;
    cwd: string;
    model: string;
    title: string;
    created_at: string;
    updated_at: string;
    max_messages: number;
    message_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    last_user_message: string | null;
    session_metadata_json: string;
    /** P24 */
    permission_mode: string | null;
    activated_skills: string | null;
    parent_session_id: string | null;
}

function ensureSessionSchema(db: SqliteDatabase): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            project_root TEXT NOT NULL,
            cwd TEXT NOT NULL,
            model TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            max_messages INTEGER NOT NULL DEFAULT 100,
            message_count INTEGER NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            last_user_message TEXT,
            session_metadata_json TEXT NOT NULL DEFAULT '{}'
        );
    `);
    ensureColumn(
        db,
        'sessions',
        'session_metadata_json',
        `TEXT NOT NULL DEFAULT '{}'`,
    );
    // P24 columns — added via migration v4; ensureColumn guards for existing DBs
    ensureColumn(db, 'sessions', 'permission_mode', 'TEXT');
    ensureColumn(db, 'sessions', 'activated_skills', `TEXT DEFAULT '[]'`);
    ensureColumn(db, 'sessions', 'parent_session_id', 'TEXT');
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_messages (
            session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            message_json TEXT NOT NULL,
            PRIMARY KEY (session_id, seq),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_project_root_updated
        ON sessions(project_root, updated_at DESC);
    `);
}

function ensureColumn(
    db: SqliteDatabase,
    tableName: string,
    columnName: string,
    columnDefinition: string,
): void {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

    if (rows.some((row) => row.name === columnName)) {
        return;
    }

    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
}

function parseSessionRow(row: SessionRow): {
    summary: PersistedSessionSummary;
    metadata: AgentSessionMetadataSnapshot;
} {
    const rawMetadata = safeParseJson(row.session_metadata_json);
    const metadata = normalizeSessionMetadataSnapshot(rawMetadata);
    const usageMetadata = readOptionalSessionUsage(
        typeof rawMetadata === 'object' && rawMetadata !== null
            ? (rawMetadata as Record<string, unknown>)['usage']
            : undefined,
    );

    return {
        summary: {
            id: row.id,
            projectRoot: row.project_root,
            cwd: row.cwd,
            model: row.model,
            title: row.title,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            maxMessages: row.max_messages,
            messageCount: row.message_count,
            usage: {
                promptTokens: row.prompt_tokens,
                completionTokens: row.completion_tokens,
                totalTokens: row.total_tokens,
                ...usageMetadata,
            },
            ...(row.last_user_message ? { lastUserMessage: row.last_user_message } : {}),
            compactionCount: metadata.compactions.length,
            commandCount: metadata.commandHistory.length,
            fileChangeCount: metadata.fileChanges.length,
            // P24 fields
            ...(row.permission_mode ? { permissionMode: row.permission_mode } : {}),
            activatedSkills: safeParseSkills(row.activated_skills),
            ...(row.parent_session_id ? { parentSessionId: row.parent_session_id } : {}),
        },
        metadata,
    };
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function safeParseSkills(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

function safeRollback(db: SqliteDatabase): void {
    try {
        db.exec('ROLLBACK;');
    } catch {
        // Ignore rollback failures: the original write error is the actionable one.
    }
}

function deriveSessionTitle(messages: ReturnType<AgentSession['getMessages']>, projectRoot: string): string {
    const firstUserMessage = messages.find((message) => message.role === 'user')?.content?.trim();
    if (!firstUserMessage) {
        return path.basename(projectRoot) || 'xqoder-session';
    }

    return firstUserMessage.length > 48
        ? `${firstUserMessage.slice(0, 45)}...`
        : firstUserMessage;
}

function findLastUserMessage(messages: ReturnType<AgentSession['getMessages']>): string | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === 'user') {
            return messages[index].content;
        }
    }

    return undefined;
}
