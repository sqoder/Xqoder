// ============================================================
// Database Migration System — SQLite schema version management
// ============================================================

/**
 * Simple interface for SQLite database operations
 */
export interface DatabaseLike {
    exec(sql: string): void;
    prepare(sql: string): {
        get(...params: any[]): any;
        all(...params: any[]): any[];
        run(...params: any[]): void;
    };
}

export interface Migration {
    version: number;
    name: string;
    up: string;
}

const MIGRATIONS: Migration[] = [
    {
        version: 1,
        name: 'initial_schema',
        up: `
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_root TEXT NOT NULL,
                cwd TEXT NOT NULL,
                model TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                max_messages INTEGER NOT NULL DEFAULT 200,
                session_metadata_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS session_messages (
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                message_json TEXT NOT NULL,
                PRIMARY KEY (session_id, seq),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
        `,
    },
    {
        version: 2,
        name: 'add_tags_and_pinned',
        up: `
            ALTER TABLE sessions ADD COLUMN tags TEXT DEFAULT '[]';
            ALTER TABLE sessions ADD COLUMN pinned INTEGER DEFAULT 0;
        `,
    },
    {
        version: 3,
        name: 'add_file_changes_table',
        up: `
            CREATE TABLE IF NOT EXISTS session_file_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                change_type TEXT NOT NULL DEFAULT 'modify',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_file_changes_session ON session_file_changes(session_id);
        `,
    },
    {
        version: 4,
        name: 'p24_session_lifecycle',
        up: `
            ALTER TABLE sessions ADD COLUMN permission_mode TEXT;
            ALTER TABLE sessions ADD COLUMN activated_skills TEXT DEFAULT '[]';
            ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
        `,
    },
];

/**
 * Ensure the schema_version table exists and run pending migrations.
 */
export function runMigrations(db: DatabaseLike): { applied: number; currentVersion: number } {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);

    const currentVersion = getCurrentVersion(db);
    let applied = 0;

    for (const migration of MIGRATIONS) {
        if (migration.version <= currentVersion) continue;

        try {
            db.exec(migration.up);
            db.exec(
                `INSERT INTO schema_version (version, name) VALUES (${migration.version}, '${migration.name}')`,
            );
            applied++;
        } catch (err) {
            // If column already exists or table already exists, skip gracefully
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('already exists') || msg.includes('duplicate column')) {
                db.exec(
                    `INSERT OR IGNORE INTO schema_version (version, name) VALUES (${migration.version}, '${migration.name}')`,
                );
                continue;
            }
            throw err;
        }
    }

    return { applied, currentVersion: getLatestMigrationVersion() };
}

export function getCurrentVersion(db: DatabaseLike): number {
    try {
        const stmt = db.prepare('SELECT MAX(version) as v FROM schema_version');
        const row = stmt.get() as { v: number | null } | undefined;
        return row?.v ?? 0;
    } catch {
        return 0;
    }
}

export function getLatestMigrationVersion(): number {
    return MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0;
}

export function getPendingMigrations(db: DatabaseLike): Migration[] {
    const current = getCurrentVersion(db);
    return MIGRATIONS.filter(m => m.version > current);
}
