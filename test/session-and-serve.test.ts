import { describe, expect, it } from 'bun:test';
import { resolveSessionForExport, resolveSessionForTui } from '../src/application/sessions/session-resolve.js';
import { assertServeDirectoryWritable, resolveServeRuntimeOptions } from '../src/commands/remote/serve.js';

describe('session resolution helpers', () => {
    it('returns the latest session for TUI resume', () => {
        const session = { id: 'session-1' } as any;
        const summary = { id: 'session-1', title: 'Latest Session' } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => summary,
        };

        expect(resolveSessionForTui(store as any, '/project')).toEqual({
            sessionId: 'session-1',
            title: 'Latest Session',
        });
    });

    it('throws when exporting a session without a summary', () => {
        const session = { id: 'session-2' } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => null,
        };

        expect(() => resolveSessionForExport(store as any, undefined, '/project')).toThrow(
            'Unable to read session summary: session-2',
        );
    });

    it('omits the title field when the session summary has no title', () => {
        const session = { id: 'session-3' } as any;
        const summary = { id: 'session-3', title: undefined } as any;
        const store = {
            findLatestSession: () => session,
            getSession: () => session,
            getSessionSummary: () => summary,
        };

        const resolved = resolveSessionForTui(store as any, '/project');

        expect(resolved).toEqual({
            sessionId: 'session-3',
        });
        expect(resolved ? 'title' in resolved : false).toBe(false);
    });
});

describe('serve command helpers', () => {
    it('uses config defaults when CLI overrides are omitted', () => {
        const runtimeOptions = resolveServeRuntimeOptions(
            { dir: '/tmp/project' },
            {
                port: 4123,
                hostname: '0.0.0.0',
                cors: ['https://example.com'],
            },
            {},
        );

        expect(runtimeOptions).toEqual({
            cwd: '/tmp/project',
            port: 4123,
            hostname: '0.0.0.0',
            cors: ['https://example.com'],
            password: undefined,
            username: 'xqoder',
        });
    });

    it('prefers explicit CLI and env overrides', () => {
        const runtimeOptions = resolveServeRuntimeOptions(
            {
                dir: '/tmp/project',
                port: '4999',
                hostname: '127.0.0.2',
                cors: 'https://a.test, https://b.test',
            },
            {
                port: 4123,
                hostname: '0.0.0.0',
                cors: ['https://example.com'],
            },
            {
                XQODER_SERVER_PASSWORD: 'secret',
                XQODER_SERVER_USERNAME: 'alice',
            },
        );

        expect(runtimeOptions).toEqual({
            cwd: '/tmp/project',
            port: 4999,
            hostname: '127.0.0.2',
            cors: ['https://a.test', 'https://b.test'],
            password: 'secret',
            username: 'alice',
        });
    });

    it('rejects missing and read-only serve directories', () => {
        expect(() => assertServeDirectoryWritable('/tmp/project', {
            existsSync: () => false,
        })).toThrow('Project directory does not exist: /tmp/project');

        expect(() => assertServeDirectoryWritable('/tmp/project', {
            existsSync: () => true,
            accessSync: () => {
                throw new Error('readonly');
            },
        })).toThrow('Project directory is not writable, session will not persist: /tmp/project');
    });
});
