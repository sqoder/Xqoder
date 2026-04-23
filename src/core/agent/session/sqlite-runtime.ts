import { createRequire } from 'node:module';
import type { DatabaseLike } from './migrations.js';

export type SqliteRuntimeKind = 'bun' | 'node';

export interface SqliteDatabase extends DatabaseLike {
    close(): void;
}

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;
type RequireLike = (id: string) => unknown;

const defaultRequire = createRequire(import.meta.url);

export function detectSqliteRuntime(
    versions: NodeJS.ProcessVersions & { bun?: string } = process.versions,
): SqliteRuntimeKind {
    return versions.bun ? 'bun' : 'node';
}

export function createSqliteDatabase(
    filename: string,
    options: {
        runtime?: SqliteRuntimeKind;
        requireModule?: RequireLike;
    } = {},
): SqliteDatabase {
    const runtime = options.runtime ?? detectSqliteRuntime();
    const requireModule = options.requireModule ?? defaultRequire;
    const moduleName = runtime === 'bun' ? 'bun:sqlite' : 'better-sqlite3';
    const loaded = requireModule(moduleName);
    const Database = resolveDatabaseConstructor(loaded, moduleName);

    return new Database(filename);
}

function resolveDatabaseConstructor(loaded: unknown, moduleName: string): SqliteDatabaseConstructor {
    if (typeof loaded === 'function') {
        return loaded as SqliteDatabaseConstructor;
    }

    if (loaded && typeof loaded === 'object') {
        const maybeModule = loaded as {
            Database?: unknown;
            default?: unknown;
        };
        if (typeof maybeModule.Database === 'function') {
            return maybeModule.Database as SqliteDatabaseConstructor;
        }
        if (typeof maybeModule.default === 'function') {
            return maybeModule.default as SqliteDatabaseConstructor;
        }
    }

    throw new Error(`Unable to load SQLite runtime module: ${moduleName}`);
}
