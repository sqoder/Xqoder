// P19b — SQLite-backed cron job store.
//
// Separate DB file from tasks.sqlite/sessions.sqlite. Cron jobs live
// longer than a single task and shorter than a conversation, and keeping
// them isolated lets us reset one surface without touching the others.
//
// A CronJob row stores:
//   - the cron expression (validated at write-time via parseCronExpression)
//   - the *template* for the task to create on each fire (title / type /
//     command / cwd / metadata) — the scheduler materialises a real Task
//     from the template at fire time
//   - enabled flag (soft delete / pause)
//   - lastFiredAt / nextFireAt, for observability and the scheduler's
//     idle-wake computation

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createSqliteDatabase,
    type SqliteDatabase,
} from '../agent/session/sqlite-runtime.js';
import { isTaskType, type TaskType } from '../tasks/task-types.js';
import {
    isValidCronExpression,
    nextFireAt,
    parseCronExpression,
} from './cron-expression.js';

export interface CronTaskTemplate {
    title: string;
    type: TaskType;
    command?: string;
    cwd?: string;
    metadata?: Record<string, unknown>;
}

export interface CronJob {
    id: string;
    expression: string;
    enabled: boolean;
    template: CronTaskTemplate;
    createdAt: Date;
    updatedAt: Date;
    lastFiredAt?: Date;
    nextFireAt?: Date;
}

export interface CreateCronJobInput {
    expression: string;
    template: CronTaskTemplate;
    enabled?: boolean;
}

export interface UpdateCronJobPatch {
    expression?: string;
    enabled?: boolean;
    template?: CronTaskTemplate;
    lastFiredAt?: Date | null;
    nextFireAt?: Date | null;
}

export interface ListCronJobsFilter {
    enabled?: boolean;
    limit?: number;
}

export interface CronStore {
    create(input: CreateCronJobInput, now?: Date): CronJob;
    get(id: string): CronJob | null;
    list(filter?: ListCronJobsFilter): CronJob[];
    update(id: string, patch: UpdateCronJobPatch): CronJob;
    delete(id: string): void;
    recordFire(id: string, firedAt: Date): CronJob;
    close(): void;
}

export function createCronStore(dbPath: string): CronStore {
    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const db = createSqliteDatabase(resolved);
    db.exec('PRAGMA foreign_keys = ON;');
    ensureCronSchema(db);

    function rowToJob(row: CronJobRow): CronJob {
        const template = parseTemplate(row.template_json);
        const job: CronJob = {
            id: row.id,
            expression: row.expression,
            enabled: row.enabled === 1,
            template,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
        if (row.last_fired_at) job.lastFiredAt = new Date(row.last_fired_at);
        if (row.next_fire_at) job.nextFireAt = new Date(row.next_fire_at);
        return job;
    }

    return {
        create(input, now = new Date()) {
            const template = normaliseTemplate(input.template);
            if (!isValidCronExpression(input.expression)) {
                throw new Error(`Invalid cron expression: ${input.expression}`);
            }
            const parsed = parseCronExpression(input.expression);
            const id = generateCronId();
            const enabled = input.enabled !== false;
            const nextAt = enabled ? nextFireAt(parsed, now) : null;
            const nowIso = now.toISOString();
            db.prepare(`
                INSERT INTO cron_jobs (
                    id, expression, enabled, template_json,
                    created_at, updated_at, last_fired_at, next_fire_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
            `).run(
                id,
                parsed.raw,
                enabled ? 1 : 0,
                JSON.stringify(template),
                nowIso,
                nowIso,
                nextAt ? nextAt.toISOString() : null,
            );
            const reloaded = this.get(id);
            if (!reloaded) {
                throw new Error(`Failed to reload newly created cron job: ${id}`);
            }
            return reloaded;
        },

        get(id) {
            const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as
                | CronJobRow
                | undefined;
            return row ? rowToJob(row) : null;
        },

        list(filter = {}) {
            const clauses: string[] = [];
            const params: unknown[] = [];
            if (filter.enabled !== undefined) {
                clauses.push('enabled = ?');
                params.push(filter.enabled ? 1 : 0);
            }
            const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
            const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
            const rows = db.prepare(`
                SELECT * FROM cron_jobs
                ${where}
                ORDER BY created_at DESC, rowid DESC
                LIMIT ?
            `).all(...params, limit) as CronJobRow[];
            return rows.map(rowToJob);
        },

        update(id, patch) {
            const current = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as
                | CronJobRow
                | undefined;
            if (!current) {
                throw new Error(`Cron job not found: ${id}`);
            }

            let expression = current.expression;
            if (patch.expression !== undefined) {
                if (!isValidCronExpression(patch.expression)) {
                    throw new Error(`Invalid cron expression: ${patch.expression}`);
                }
                expression = parseCronExpression(patch.expression).raw;
            }

            const enabled =
                patch.enabled === undefined ? current.enabled === 1 : patch.enabled;
            const template =
                patch.template === undefined
                    ? parseTemplate(current.template_json)
                    : normaliseTemplate(patch.template);

            const now = new Date();
            const nowIso = now.toISOString();

            const lastFiredAt =
                patch.lastFiredAt === undefined
                    ? current.last_fired_at
                    : patch.lastFiredAt
                      ? patch.lastFiredAt.toISOString()
                      : null;

            let nextAt: string | null;
            if (patch.nextFireAt !== undefined) {
                nextAt = patch.nextFireAt ? patch.nextFireAt.toISOString() : null;
            } else if (
                patch.expression !== undefined ||
                patch.enabled !== undefined
            ) {
                // Recompute next fire when schedule or enabled state changes.
                if (enabled) {
                    const parsed = parseCronExpression(expression);
                    nextAt = nextFireAt(parsed, now).toISOString();
                } else {
                    nextAt = null;
                }
            } else {
                nextAt = current.next_fire_at;
            }

            db.prepare(`
                UPDATE cron_jobs SET
                    expression = ?,
                    enabled = ?,
                    template_json = ?,
                    updated_at = ?,
                    last_fired_at = ?,
                    next_fire_at = ?
                WHERE id = ?
            `).run(
                expression,
                enabled ? 1 : 0,
                JSON.stringify(template),
                nowIso,
                lastFiredAt,
                nextAt,
                id,
            );
            const reloaded = this.get(id);
            if (!reloaded) {
                throw new Error(`Failed to reload cron job after update: ${id}`);
            }
            return reloaded;
        },

        delete(id) {
            db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
        },

        recordFire(id, firedAt) {
            const current = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as
                | CronJobRow
                | undefined;
            if (!current) {
                throw new Error(`Cron job not found: ${id}`);
            }
            const parsed = parseCronExpression(current.expression);
            const nextAt = nextFireAt(parsed, firedAt).toISOString();
            const updatedAt = new Date().toISOString();
            db.prepare(`
                UPDATE cron_jobs SET
                    last_fired_at = ?,
                    next_fire_at = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(firedAt.toISOString(), nextAt, updatedAt, id);
            const reloaded = this.get(id);
            if (!reloaded) {
                throw new Error(`Failed to reload cron job after fire: ${id}`);
            }
            return reloaded;
        },

        close() {
            db.close();
        },
    };
}

interface CronJobRow {
    id: string;
    expression: string;
    enabled: number;
    template_json: string;
    created_at: string;
    updated_at: string;
    last_fired_at: string | null;
    next_fire_at: string | null;
}

function parseTemplate(raw: string): CronTaskTemplate {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Corrupt cron template JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Cron template is not an object`);
    }
    return normaliseTemplate(parsed as Record<string, unknown>);
}

function normaliseTemplate(raw: Record<string, unknown> | CronTaskTemplate): CronTaskTemplate {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) {
        throw new Error('Cron template: `title` must be a non-empty string');
    }
    const typeValue = (raw as { type?: unknown }).type;
    if (!isTaskType(typeValue)) {
        throw new Error(`Cron template: \`type\` must be one of the known task types (got ${String(typeValue)})`);
    }
    const template: CronTaskTemplate = { title, type: typeValue };
    const command = (raw as { command?: unknown }).command;
    if (typeof command === 'string' && command.trim().length > 0) {
        template.command = command;
    }
    const cwd = (raw as { cwd?: unknown }).cwd;
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
        template.cwd = cwd;
    }
    const metadata = (raw as { metadata?: unknown }).metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        template.metadata = metadata as Record<string, unknown>;
    }
    return template;
}

function generateCronId(): string {
    return `cron_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureCronSchema(db: SqliteDatabase): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cron_jobs (
            id TEXT PRIMARY KEY,
            expression TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            template_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_fired_at TEXT,
            next_fire_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cron_enabled ON cron_jobs(enabled);
        CREATE INDEX IF NOT EXISTS idx_cron_next_fire_at ON cron_jobs(next_fire_at);
    `);
}
