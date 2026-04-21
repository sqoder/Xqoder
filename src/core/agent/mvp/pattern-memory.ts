import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
    MvpFailureClassification,
    MvpFailurePattern,
    MvpRecoveryAction,
    MvpRecoveryOutcome,
    MvpTaskType,
} from './types.js';

interface PersistedPatternRow {
    id: string;
    task_type: string;
    error_sig: string;
    error_category: string;
    strategy: string;
    outcome: string;
    occurrences: number;
    last_seen_at: number;
}

export class MvpFailurePatternMemory {
    private db?: Database.Database;
    private readonly fallback = new Map<string, MvpFailurePattern>();

    constructor(
        projectPath: string,
        private readonly warn: (message: string) => void = (message) => console.warn(message),
    ) {
        try {
            const projectHash = createHash('sha256')
                .update(path.resolve(projectPath))
                .digest('hex')
                .slice(0, 12);
            const rootDir = path.join(os.homedir(), '.xqoder', projectHash);
            fs.mkdirSync(rootDir, { recursive: true });
            this.db = new Database(path.join(rootDir, 'failures.db'));
            this.initSchema();
        } catch (error) {
            this.warn(
                `[xqoder] Failure pattern memory disabled; falling back to in-memory storage (${error instanceof Error ? error.message : String(error)})`,
            );
        }
    }

    query(errorSignature: string, taskType: MvpTaskType): MvpFailurePattern | null {
        const normalizedSignature = normalizeMvpFailureSignature(errorSignature);
        if (!this.db) {
            return queryFallback(this.fallback, normalizedSignature, taskType);
        }

        const row = this.db.prepare(`
            SELECT *
            FROM patterns
            WHERE error_sig = ? AND task_type = ? AND outcome = 'success'
            ORDER BY occurrences DESC, last_seen_at DESC
            LIMIT 1
        `).get(normalizedSignature, taskType) as PersistedPatternRow | undefined;

        return row ? hydratePattern(row) : null;
    }

    record(input: {
        taskType: MvpTaskType;
        errorSignature: string;
        errorCategory: MvpFailureClassification;
        strategy: MvpRecoveryAction;
        outcome: MvpRecoveryOutcome;
    }): void {
        const normalizedSignature = normalizeMvpFailureSignature(input.errorSignature);
        if (!this.db) {
            recordFallback(this.fallback, normalizedSignature, input);
            return;
        }

        const existing = this.db.prepare(`
            SELECT id, occurrences
            FROM patterns
            WHERE error_sig = ? AND task_type = ? AND strategy = ?
            LIMIT 1
        `).get(normalizedSignature, input.taskType, input.strategy) as
            | { id: string; occurrences: number }
            | undefined;

        if (existing) {
            this.db.prepare(`
                UPDATE patterns
                SET occurrences = occurrences + 1,
                    last_seen_at = ?,
                    outcome = ?,
                    error_category = ?
                WHERE id = ?
            `).run(Date.now(), input.outcome, input.errorCategory, existing.id);
            return;
        }

        this.db.prepare(`
            INSERT INTO patterns (
                id,
                task_type,
                error_sig,
                error_category,
                strategy,
                outcome,
                occurrences,
                last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
            randomUUID(),
            input.taskType,
            normalizedSignature,
            input.errorCategory,
            input.strategy,
            input.outcome,
            Date.now(),
        );
    }

    close(): void {
        this.db?.close();
    }

    private initSchema(): void {
        if (!this.db) {
            return;
        }

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS patterns (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                error_sig TEXT NOT NULL,
                error_category TEXT NOT NULL,
                strategy TEXT NOT NULL,
                outcome TEXT NOT NULL,
                occurrences INTEGER NOT NULL DEFAULT 1,
                last_seen_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_error_sig_task_outcome
                ON patterns (error_sig, task_type, outcome);
        `);
    }
}

export function normalizeMvpFailureSignature(raw: string): string {
    return raw
        .replace(/\/[^\s:'"]+:\d+(?::\d+)?/g, '<file>:<line>')
        .replace(/[A-Za-z]:\\[^\s:'"]+:\d+(?::\d+)?/g, '<file>:<line>')
        .replace(/0x[0-9a-fA-F]+/g, '<addr>')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);
}

function hydratePattern(row: PersistedPatternRow): MvpFailurePattern {
    return {
        id: row.id,
        taskType: row.task_type as MvpTaskType,
        errorSignature: row.error_sig,
        errorCategory: row.error_category as MvpFailureClassification,
        strategy: row.strategy as MvpRecoveryAction,
        outcome: row.outcome as MvpRecoveryOutcome,
        occurrences: row.occurrences,
        lastSeenAt: row.last_seen_at,
    };
}

function queryFallback(
    store: Map<string, MvpFailurePattern>,
    normalizedSignature: string,
    taskType: MvpTaskType,
): MvpFailurePattern | null {
    const matches = Array.from(store.values())
        .filter((entry) => {
            return entry.errorSignature === normalizedSignature
                && entry.taskType === taskType
                && entry.outcome === 'success';
        })
        .sort((left, right) => {
            if (right.occurrences !== left.occurrences) {
                return right.occurrences - left.occurrences;
            }

            return right.lastSeenAt - left.lastSeenAt;
        });

    return matches[0] ?? null;
}

function recordFallback(
    store: Map<string, MvpFailurePattern>,
    normalizedSignature: string,
    input: {
        taskType: MvpTaskType;
        errorCategory: MvpFailureClassification;
        strategy: MvpRecoveryAction;
        outcome: MvpRecoveryOutcome;
    },
): void {
    const key = `${input.taskType}:${normalizedSignature}:${input.strategy}`;
    const existing = store.get(key);
    if (existing) {
        store.set(key, {
            ...existing,
            errorCategory: input.errorCategory,
            outcome: input.outcome,
            occurrences: existing.occurrences + 1,
            lastSeenAt: Date.now(),
        });
        return;
    }

    store.set(key, {
        id: randomUUID(),
        taskType: input.taskType,
        errorSignature: normalizedSignature,
        errorCategory: input.errorCategory,
        strategy: input.strategy,
        outcome: input.outcome,
        occurrences: 1,
        lastSeenAt: Date.now(),
    });
}
