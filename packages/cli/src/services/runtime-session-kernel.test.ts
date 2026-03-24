import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, SQLiteSessionStore } from '@xqoder/agent';
import { readProjectMemoryFile } from '@xqoder/shared';
import {
    createRuntimeSessionKernelHandle,
    openInMemoryRuntimeSessionKernel,
    resolveRuntimeSessionStore,
} from './runtime-session-kernel.js';

describe('runtime-session-kernel', () => {
    const cleanupPaths: string[] = [];

    afterEach(() => {
        while (cleanupPaths.length > 0) {
            const next = cleanupPaths.pop();
            if (next) {
                rmSync(next, { recursive: true, force: true });
            }
        }
    });

    it('keeps sqlite and in-memory handles aligned on summary and sessionId', async () => {
        const defaults = {
            projectRoot: '/tmp/xqoder-runtime-kernel-handle',
            model: 'gpt-4.1',
        };
        const sqliteDir = mkdtempSync(path.join(tmpdir(), 'xqoder-runtime-session-kernel-'));
        cleanupPaths.push(sqliteDir);

        const sqliteStore = new SQLiteSessionStore(path.join(sqliteDir, 'sessions.db'));
        const sqliteHandle = createRuntimeSessionKernelHandle(sqliteStore, defaults, {
            close: () => {
                sqliteStore.close();
            },
        });
        const memoryHandle = openInMemoryRuntimeSessionKernel(defaults);

        try {
            const collect = async (label: string, handle: typeof sqliteHandle | typeof memoryHandle) => {
                const session = new AgentSession({
                    id: `session_${label}`,
                    title: `Session ${label}`,
                    createdAt: new Date('2026-03-22T00:00:00.000Z'),
                    messages: [
                        { role: 'user', content: 'hello runtime kernel' },
                    ],
                });

                const saved = handle.store.saveSessionSnapshot({
                    session,
                    projectRoot: defaults.projectRoot,
                    cwd: defaults.projectRoot,
                    model: defaults.model,
                    title: session.getTitle(),
                });
                const appended = handle.store.appendSessionMessage({
                    sessionId: saved.id,
                    projectRoot: defaults.projectRoot,
                    cwd: defaults.projectRoot,
                    model: defaults.model,
                    message: {
                        role: 'assistant',
                        content: 'runtime kernel reply',
                    },
                });
                const record = await handle.kernel.loadSessionSnapshot(saved.id);
                const listed = await handle.kernel.listSessions({
                    projectRoot: defaults.projectRoot,
                    limit: 1,
                });

                return {
                    saved: {
                        id: saved.id,
                        projectRoot: saved.projectRoot,
                        cwd: saved.cwd,
                        model: saved.model,
                        title: saved.title,
                        messageCount: saved.messageCount,
                        lastUserMessage: saved.lastUserMessage,
                    },
                    appended: {
                        id: appended.id,
                        projectRoot: appended.projectRoot,
                        cwd: appended.cwd,
                        model: appended.model,
                        title: appended.title,
                        messageCount: appended.messageCount,
                        lastUserMessage: appended.lastUserMessage,
                    },
                    record: record
                        ? {
                            id: record.id,
                            cwd: record.cwd,
                            title: record.title,
                            projectRoot: String(record.metadata?.['projectRoot'] ?? ''),
                            model: String(record.metadata?.['model'] ?? ''),
                            messageContents: record.messages.map((message) => message.content),
                        }
                        : null,
                    listedId: listed[0]?.id ?? null,
                };
            };

            const sqliteState = await collect('sqlite', sqliteHandle);
            const memoryState = await collect('sqlite', memoryHandle);

            expect(sqliteState.saved).toEqual(memoryState.saved);
            expect(sqliteState.appended).toEqual(memoryState.appended);
            expect(sqliteState.record).toEqual(memoryState.record);
            expect(sqliteState.listedId).toBe(memoryState.listedId);
        } finally {
            sqliteHandle.close();
            memoryHandle.close();
        }
    });

    it('fails fast when a compat store is missing saveSessionSnapshot', () => {
        const saveSession = vi.fn(() => {
            throw new Error('deprecated saveSession should not be called');
        });
        const compatStore = {
            getSessionSummary: vi.fn().mockReturnValue(null),
            saveSession,
        };

        const resolved = resolveRuntimeSessionStore(compatStore as never, {
            projectRoot: '/tmp/xqoder-runtime-kernel-invalid-compat',
            cwd: '/tmp/xqoder-runtime-kernel-invalid-compat',
            model: 'gpt-4.1',
        });

        expect(() => resolved.saveSessionSnapshot({
            session: new AgentSession({
                id: 'session_invalid_compat',
            }),
            projectRoot: '/tmp/xqoder-runtime-kernel-invalid-compat',
            cwd: '/tmp/xqoder-runtime-kernel-invalid-compat',
            model: 'gpt-4.1',
        })).toThrow('saveSessionSnapshot');
        expect(saveSession).not.toHaveBeenCalled();
    });

    it('syncs persisted session metadata into project memory on save', () => {
        const projectRoot = mkdtempSync(path.join(tmpdir(), 'xqoder-runtime-project-memory-'));
        cleanupPaths.push(projectRoot);
        const handle = openInMemoryRuntimeSessionKernel({
            projectRoot,
            model: 'gpt-4.1',
        });

        try {
            const session = new AgentSession({
                id: 'session_project_memory',
                title: 'Project Memory Session',
                messages: [
                    { role: 'system', content: 'system' },
                    { role: 'user', content: 'repair daemon reliability' },
                ],
                metadata: {
                    compactSummary: '- 最近在修复 daemon reliability',
                    compactions: [],
                    toolHistory: [{
                        id: 'tool-1',
                        name: 'read_file',
                        args: { path: `${projectRoot}/packages/daemon/src/server.ts` },
                        success: true,
                        outputPreview: 'ok',
                        startedAt: new Date('2026-03-22T00:00:00.000Z'),
                        completedAt: new Date('2026-03-22T00:00:01.000Z'),
                    }],
                    commandHistory: [{
                        id: 'cmd-1',
                        command: 'pnpm --filter @xqoder/daemon test',
                        cwd: projectRoot,
                        success: true,
                        outputPreview: 'ok',
                        startedAt: new Date('2026-03-22T00:00:02.000Z'),
                        completedAt: new Date('2026-03-22T00:00:03.000Z'),
                    }],
                    fileChanges: [{
                        id: 'file-1',
                        path: `${projectRoot}/packages/daemon/src/server.ts`,
                        changeType: 'patch',
                        bytes: 128,
                        success: true,
                        timestamp: new Date('2026-03-22T00:00:04.000Z'),
                    }],
                },
            });

            handle.store.saveSessionSnapshot({
                session,
                projectRoot,
                cwd: projectRoot,
                model: 'gpt-4.1',
                title: session.getTitle(),
            });

            const memory = readProjectMemoryFile(projectRoot);
            expect(memory?.session).toMatchObject({
                sessionId: session.id,
                compactSummary: '- 最近在修复 daemon reliability',
                recentCommands: [
                    expect.objectContaining({ command: 'pnpm --filter @xqoder/daemon test', success: true }),
                ],
                recentFileChanges: [
                    expect.objectContaining({ path: `${projectRoot}/packages/daemon/src/server.ts`, changeType: 'patch' }),
                ],
                recentTools: [
                    expect.objectContaining({ name: 'read_file', success: true }),
                ],
            });
        } finally {
            handle.close();
        }
    });
});
