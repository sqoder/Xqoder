import { describe, expect, it } from 'bun:test';
import {
    createSqliteDatabase,
    detectSqliteRuntime,
    type SqliteDatabase,
} from '../../src/core/agent/session/sqlite-runtime.js';

class FakeDatabase implements SqliteDatabase {
    constructor(readonly filename: string) {}

    exec(): void {}

    prepare(): {
        get(): undefined;
        all(): unknown[];
        run(): void;
    } {
        return {
            get: () => undefined,
            all: () => [],
            run: () => {},
        };
    }

    close(): void {}
}

describe('SQLite runtime adapter', () => {
    it('selects bun:sqlite only when running under Bun', () => {
        expect(detectSqliteRuntime({ bun: '1.3.12' } as NodeJS.ProcessVersions & { bun?: string })).toBe('bun');
        expect(detectSqliteRuntime({ node: process.versions.node } as NodeJS.ProcessVersions)).toBe('node');
    });

    it('loads better-sqlite3 for Node runtime through the adapter', () => {
        const moduleNames: string[] = [];
        const db = createSqliteDatabase('/tmp/node.sqlite', {
            runtime: 'node',
            requireModule: (moduleName) => {
                moduleNames.push(moduleName);
                return FakeDatabase;
            },
        }) as FakeDatabase;

        expect(moduleNames).toEqual(['better-sqlite3']);
        expect(db.filename).toBe('/tmp/node.sqlite');
    });

    it('loads bun:sqlite for Bun runtime through the adapter', () => {
        const moduleNames: string[] = [];
        const db = createSqliteDatabase('/tmp/bun.sqlite', {
            runtime: 'bun',
            requireModule: (moduleName) => {
                moduleNames.push(moduleName);
                return { Database: FakeDatabase };
            },
        }) as FakeDatabase;

        expect(moduleNames).toEqual(['bun:sqlite']);
        expect(db.filename).toBe('/tmp/bun.sqlite');
    });
});
