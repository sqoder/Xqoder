// P19a — SQLite-backed task store (persistent, cross-session, resumable).
//
// Separate DB file from sessions.sqlite — tasks have their own lifecycle,
// and keeping them isolated makes it easy to reset / migrate without
// touching conversation history.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createSqliteDatabase,
    type SqliteDatabase,
} from '../agent/session/sqlite-runtime.js';
import {
    isTaskStatus,
    isTaskType,
    isTerminalStatus,
    type Task,
    type TaskStatus,
    type TaskType,
} from './task-types.js';

export interface CreateTaskInput {
    title: string;
    type: TaskType;
    command?: string;
    sessionId?: string;
    logPath?: string;
    metadata?: Record<string, unknown>;
}

export interface UpdateTaskPatch {
    title?: string;
    status?: TaskStatus;
    pid?: number | null;
    logPath?: string | null;
    exitCode?: number | null;
    error?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface ListTasksFilter {
    status?: TaskStatus;
    type?: TaskType;
    limit?: number;
}

export interface TaskStore {
    create(input: CreateTaskInput): Task;
    get(id: string): Task | null;
    list(filter?: ListTasksFilter): Task[];
    update(id: string, patch: UpdateTaskPatch): Task;
    delete(id: string): void;
    close(): void;
}

export function createTaskStore(dbPath: string): TaskStore {
    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const db = createSqliteDatabase(resolved);
    db.exec('PRAGMA foreign_keys = ON;');
    ensureTaskSchema(db);

    return {
        create(input) {
            if (!isTaskType(input.type)) {
                throw new Error(`Unknown task type: ${String(input.type)}`);
            }
            const id = generateTaskId();
            const now = new Date();
            const nowIso = now.toISOString();
            db.prepare(`
                INSERT INTO tasks (
                    id, title, type, status, created_at, updated_at,
                    command, session_id, log_path, metadata_json
                ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                input.title,
                input.type,
                nowIso,
                nowIso,
                input.command ?? null,
                input.sessionId ?? null,
                input.logPath ?? null,
                JSON.stringify(input.metadata ?? {}),
            );

            const row = this.get(id);
            if (!row) {
                throw new Error(`Unable to reload newly created task: ${id}`);
            }
            return row;
        },

        get(id) {
            const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
                | TaskRow
                | undefined;
            return row ? rowToTask(row) : null;
        },

        list(filter = {}) {
            const clauses: string[] = [];
            const params: unknown[] = [];
            if (filter.status) {
                if (!isTaskStatus(filter.status)) {
                    throw new Error(`Unknown status filter: ${String(filter.status)}`);
                }
                clauses.push('status = ?');
                params.push(filter.status);
            }
            if (filter.type) {
                if (!isTaskType(filter.type)) {
                    throw new Error(`Unknown type filter: ${String(filter.type)}`);
                }
                clauses.push('type = ?');
                params.push(filter.type);
            }
            const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
            const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
            const rows = db.prepare(`
                SELECT * FROM tasks
                ${where}
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
            `).all(...params, limit) as TaskRow[];

            return rows.map(rowToTask);
        },

        update(id, patch) {
            const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
                | TaskRow
                | undefined;
            if (!current) {
                throw new Error(`Task not found: ${id}`);
            }

            if (patch.status && !isTaskStatus(patch.status)) {
                throw new Error(`Unknown status: ${String(patch.status)}`);
            }

            const nextStatus = patch.status ?? (current.status as TaskStatus);
            const now = new Date();
            const nowIso = now.toISOString();

            const nextStartedAt =
                current.started_at ??
                (patch.status === 'running' ? nowIso : null);
            const nextFinishedAt =
                current.finished_at ??
                (patch.status && isTerminalStatus(patch.status) ? nowIso : null);

            const nextMetadata =
                patch.metadata === undefined
                    ? current.metadata_json
                    : JSON.stringify(patch.metadata ?? {});

            const nextTitle =
                patch.title !== undefined && patch.title.trim().length > 0
                    ? patch.title.trim()
                    : current.title;

            db.prepare(`
                UPDATE tasks SET
                    title = ?,
                    status = ?,
                    updated_at = ?,
                    started_at = ?,
                    finished_at = ?,
                    pid = ?,
                    log_path = ?,
                    exit_code = ?,
                    error = ?,
                    session_id = ?,
                    metadata_json = ?
                WHERE id = ?
            `).run(
                nextTitle,
                nextStatus,
                nowIso,
                nextStartedAt,
                nextFinishedAt,
                applyNumberPatch(current.pid, patch.pid),
                applyStringPatch(current.log_path, patch.logPath),
                applyNumberPatch(current.exit_code, patch.exitCode),
                applyStringPatch(current.error, patch.error),
                applyStringPatch(current.session_id, patch.sessionId),
                nextMetadata,
                id,
            );

            const reloaded = this.get(id);
            if (!reloaded) {
                throw new Error(`Unable to reload task after update: ${id}`);
            }
            return reloaded;
        },

        delete(id) {
            db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        },

        close() {
            db.close();
        },
    };
}

interface TaskRow {
    id: string;
    title: string;
    type: string;
    status: string;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    finished_at: string | null;
    session_id: string | null;
    pid: number | null;
    log_path: string | null;
    command: string | null;
    exit_code: number | null;
    error: string | null;
    metadata_json: string;
}

function rowToTask(row: TaskRow): Task {
    const task: Task = {
        id: row.id,
        title: row.title,
        type: row.type as TaskType,
        status: row.status as TaskStatus,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
    if (row.started_at) task.startedAt = new Date(row.started_at);
    if (row.finished_at) task.finishedAt = new Date(row.finished_at);
    if (row.session_id) task.sessionId = row.session_id;
    if (row.pid !== null) task.pid = row.pid;
    if (row.log_path) task.logPath = row.log_path;
    if (row.command) task.command = row.command;
    if (row.exit_code !== null) task.exitCode = row.exit_code;
    if (row.error) task.error = row.error;
    task.metadata = parseMetadata(row.metadata_json);
    return task;
}

function parseMetadata(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

function applyStringPatch(
    current: string | null,
    patch: string | null | undefined,
): string | null {
    if (patch === undefined) return current;
    if (patch === null) return null;
    return patch;
}

function applyNumberPatch(
    current: number | null,
    patch: number | null | undefined,
): number | null {
    if (patch === undefined) return current;
    if (patch === null) return null;
    return patch;
}

function generateTaskId(): string {
    return `task_${crypto.randomUUID()}`;
}

function ensureTaskSchema(db: SqliteDatabase): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            session_id TEXT,
            pid INTEGER,
            log_path TEXT,
            command TEXT,
            exit_code INTEGER,
            error TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
    `);
}
