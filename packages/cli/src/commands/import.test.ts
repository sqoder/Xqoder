import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '@xqoder/runtime';
import { runImportCommand } from './import.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-import-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('import command', () => {
    it('imports an exported session document into the local store', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: '帮我看下这个仓库',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
                lastUserMessage: '帮我看下这个仓库',
            },
            snapshot: {
                id: 'session_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: '帮我看下这个仓库' },
                    { role: 'assistant', content: '先从目录结构开始。' },
                ],
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'session_demo',
            projectRoot: '/workspace/imported',
            cwd: '/workspace/imported',
            model: 'claude-sonnet-4',
            title: '帮我看下这个仓库',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:10:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: {
                promptTokens: 100,
                completionTokens: 20,
                totalTokens: 120,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported',
        }, {
            sessionStore: {
                getSessionSnapshot: vi.fn().mockReturnValue(null),
                saveSessionSnapshot,
            },
        });

        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0]).toMatchObject({
            projectRoot: '/workspace/imported',
            cwd: '/workspace/imported',
            model: 'claude-sonnet-4',
        });
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).toBe('session_demo');
    });

    it('imports into snapshot-only legacy store without getSession fallback', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session-snapshot-only.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_snapshot_only_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: 'snapshot only import',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 2,
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            },
            snapshot: {
                id: 'session_snapshot_only_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'snapshot-only import request' },
                ],
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'session_snapshot_only_demo',
            projectRoot: '/workspace/imported-snapshot-only',
            cwd: '/workspace/imported-snapshot-only',
            model: 'claude-sonnet-4',
            title: 'snapshot only import',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 2,
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported-snapshot-only',
        }, {
            sessionStore: {
                getSessionSnapshot: vi.fn().mockReturnValue(null),
                saveSessionSnapshot,
            },
        });

        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).toBe('session_snapshot_only_demo');
    });

    it('prefers saveSessionSnapshot when the legacy import store already exposes it', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session-snapshot.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: 'snapshot import',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 2,
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            },
            snapshot: {
                id: 'session_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'snapshot import request' },
                ],
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'session_demo',
            projectRoot: '/workspace/imported-snapshot',
            cwd: '/workspace/imported-snapshot',
            model: 'claude-sonnet-4',
            title: 'snapshot import',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 2,
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported-snapshot',
        }, {
            sessionStore: {
                getSessionSnapshot: vi.fn().mockReturnValue(null),
                saveSessionSnapshot,
            },
        });

        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).toBe('session_demo');
    });

    it('resolves id collisions through summary fallback without requiring getSessionSnapshot', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session-summary-collision.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_summary_collision_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: 'summary collision import',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 2,
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            },
            snapshot: {
                id: 'session_summary_collision_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'summary collision import request' },
                ],
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'session_generated',
            projectRoot: '/workspace/imported-summary-collision',
            cwd: '/workspace/imported-summary-collision',
            model: 'claude-sonnet-4',
            title: 'summary collision import',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 2,
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported-summary-collision',
        }, {
            sessionStore: {
                getSessionSummary: vi.fn((sessionId: string) => (
                    sessionId === 'session_summary_collision_demo'
                        ? {
                            id: 'session_summary_collision_demo',
                            projectRoot: '/workspace/imported-summary-collision',
                            cwd: '/workspace/imported-summary-collision',
                            model: 'claude-sonnet-4',
                            title: 'existing summary',
                            createdAt: new Date('2026-03-08T00:00:00.000Z'),
                            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                            maxMessages: 100,
                            messageCount: 2,
                            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                            compactionCount: 0,
                            commandCount: 0,
                            fileChangeCount: 0,
                        }
                        : null
                )),
                saveSessionSnapshot,
            },
        });

        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).toMatch(/^session_/);
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).not.toBe('session_summary_collision_demo');
    });

    it('imports a compatible export payload without schemaVersion and missing metadata arrays', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'compatible-session.json');
        fs.writeFileSync(filePath, JSON.stringify({
            sessionId: 'opencode_session_demo',
            projectRoot: '/workspace/opencode-demo',
            cwd: '/workspace/opencode-demo',
            model: 'gpt-5',
            title: 'compatible session import',
            createdAt: '2026-03-08T01:00:00.000Z',
            updatedAt: '2026-03-08T01:05:00.000Z',
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'hello from compatible export' },
                { role: 'assistant', content: 'compatible reply' },
            ],
            usage: {
                promptTokens: 12,
                completionTokens: 8,
                totalTokens: 20,
            },
            metadata: {
                compactSummary: 'short summary',
            },
        }, null, 2), 'utf-8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'opencode_session_demo',
            projectRoot: '/workspace/imported-compatible',
            cwd: '/workspace/imported-compatible',
            model: 'gpt-5',
            title: 'compatible session import',
            createdAt: new Date('2026-03-08T01:00:00.000Z'),
            updatedAt: new Date('2026-03-08T01:05:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: {
                promptTokens: 12,
                completionTokens: 8,
                totalTokens: 20,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: '/workspace/imported-compatible',
        }, {
            sessionStore: {
                getSessionSnapshot: vi.fn().mockReturnValue(null),
                saveSessionSnapshot,
            },
        });

        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0]).toMatchObject({
            projectRoot: '/workspace/imported-compatible',
            cwd: '/workspace/imported-compatible',
            model: 'gpt-5',
        });
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.id).toBe('opencode_session_demo');

        const snapshot = saveSessionSnapshot.mock.calls[0]?.[0].session.toSnapshot();
        expect(snapshot.metadata.compactSummary).toBe('short summary');
        expect(snapshot.metadata.compactions).toEqual([]);
        expect(snapshot.metadata.commandHistory).toEqual([]);
        expect(snapshot.metadata.toolHistory).toEqual([]);
        expect(snapshot.metadata.fileChanges).toEqual([]);
    });

    it('uses the shared runtime-kernel handle for default import flow and resolves id collisions via kernel lookup', async () => {
        const dir = createTempDir();
        const filePath = path.join(dir, 'session-kernel.json');
        fs.writeFileSync(filePath, JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-03-08T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: 'kernel import',
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            },
            snapshot: {
                id: 'session_demo',
                createdAt: '2026-03-08T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'kernel import request' },
                    {
                        role: 'assistant',
                        content: 'kernel import reply',
                        thinking: 'checking the session before import',
                        toolCalls: [{
                            id: 'tool-1',
                            name: 'read_file',
                            arguments: '{"path":"/workspace/origin/README.md"}',
                        }],
                        parts: [
                            { type: 'text', text: 'kernel import reply' },
                            { type: 'reasoning', text: 'checking the session before import' },
                            {
                                type: 'tool_call',
                                toolCall: {
                                    id: 'tool-1',
                                    name: 'read_file',
                                    arguments: '{"path":"/workspace/origin/README.md"}',
                                },
                            },
                            { type: 'finish', reason: 'stop' },
                        ],
                    },
                ],
                usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                },
            },
        }, null, 2), 'utf-8');

        const loadSessionSnapshot = vi.fn().mockResolvedValue({
            id: 'session_demo',
            cwd: '/workspace/imported-kernel',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [],
            metadata: {
                projectRoot: '/workspace/imported-kernel',
                model: 'claude-sonnet-4',
            },
        } satisfies SessionRecord);
        const commitSessionSnapshot = vi.fn().mockResolvedValue({
            id: 'session_generated',
            cwd: '/workspace/imported-kernel',
            title: 'kernel import',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [],
            metadata: {
                projectRoot: '/workspace/imported-kernel',
                model: 'claude-sonnet-4',
            },
        } satisfies SessionRecord);
        const close = vi.fn();
        const openSessionKernel = vi.fn().mockReturnValue({
            kernel: {
                loadSession: loadSessionSnapshot,
                loadSessionSnapshot,
                saveSessionSnapshot: commitSessionSnapshot,
                commitSessionSnapshot,
            },
            close,
        });

        const summary = await runImportCommand(filePath, {
            dir: '/workspace/imported-kernel',
        }, {
            openSessionKernel,
        });

        expect(openSessionKernel).toHaveBeenCalledWith({
            projectRoot: '/workspace/imported-kernel',
            model: 'claude-sonnet-4',
        });
        expect(loadSessionSnapshot).toHaveBeenCalledWith('session_demo');
        expect(commitSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(commitSessionSnapshot.mock.calls[0]?.[0]).toMatchObject({
            cwd: '/workspace/imported-kernel',
            title: 'kernel import',
        });
        expect(commitSessionSnapshot.mock.calls[0]?.[0].id).not.toBe('session_demo');
        expect(commitSessionSnapshot.mock.calls[0]?.[0].id).toMatch(/^session_/);
        expect(commitSessionSnapshot.mock.calls[0]?.[0].metadata).toMatchObject({
            projectRoot: '/workspace/imported-kernel',
            model: 'claude-sonnet-4',
        });
        expect(commitSessionSnapshot.mock.calls[0]?.[0].messages[2]).toMatchObject({
            role: 'assistant',
            content: 'kernel import reply',
            thinking: 'checking the session before import',
            toolCalls: [{
                id: 'tool-1',
                name: 'read_file',
                arguments: '{"path":"/workspace/origin/README.md"}',
            }],
            parts: [
                { type: 'text', text: 'kernel import reply' },
                { type: 'reasoning', text: 'checking the session before import' },
                {
                    type: 'tool_call',
                    toolCall: {
                        id: 'tool-1',
                        name: 'read_file',
                        arguments: '{"path":"/workspace/origin/README.md"}',
                    },
                },
                { type: 'finish', reason: 'stop' },
            ],
        });
        expect(summary).toMatchObject({
            id: 'session_generated',
            projectRoot: '/workspace/imported-kernel',
            cwd: '/workspace/imported-kernel',
            model: 'claude-sonnet-4',
            title: 'kernel import',
            messageCount: 0,
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('imports a replay bundle, reapplies workspace changes, and preserves fix history metadata', async () => {
        const dir = createTempDir();
        const importProjectDir = path.join(dir, 'import-project');
        const filePath = path.join(dir, 'session-bundle.xqoder-bundle');
        fs.mkdirSync(path.join(importProjectDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(importProjectDir, 'src', 'stale.ts'), 'stale\n', 'utf8');

        fs.writeFileSync(filePath, JSON.stringify({
            artifactKind: 'xqoder-bundle',
            bundleVersion: 1,
            schemaVersion: 1,
            exportedAt: '2026-03-23T00:10:00.000Z',
            source: {
                product: 'xqoder',
                version: '0.1.0',
            },
            summary: {
                id: 'session_bundle_demo',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'claude-sonnet-4',
                title: 'bundle import',
                createdAt: '2026-03-23T00:00:00.000Z',
                updatedAt: '2026-03-23T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 2,
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 2,
            },
            snapshot: {
                id: 'session_bundle_demo',
                createdAt: '2026-03-23T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'bundle import request' },
                ],
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
                    fixHistory: {
                        totalRuns: 2,
                        successfulRuns: 1,
                        failedRuns: 1,
                        successRate: 0.5,
                        updatedAt: '2026-03-23T00:05:00.000Z',
                        rollingWindows: [{
                            label: '7d',
                            totalRuns: 2,
                            successfulRuns: 1,
                            failedRuns: 1,
                            successRate: 0.5,
                        }],
                        recentRuns: [{
                            id: 'fix_run_1',
                            success: true,
                            attemptCount: 2,
                            totalDurationMs: 1200,
                            startedAt: '2026-03-23T00:00:10.000Z',
                            completedAt: '2026-03-23T00:00:11.200Z',
                            remediationPolicyIds: ['compile-error-v1'],
                            suspectedFailureBuckets: ['runtime_compile_error'],
                            automaticActionIds: [],
                        }],
                    },
                },
            },
            workspaceChanges: [
                {
                    relativePath: 'src/imported.ts',
                    lastChangeType: 'write',
                    changeCount: 1,
                    lastUpdatedAt: '2026-03-23T00:10:00.000Z',
                    finalExists: true,
                    finalContent: 'export const importedValue = 42;\n',
                    rollbackPointIds: [],
                },
                {
                    relativePath: 'src/stale.ts',
                    lastChangeType: 'restore',
                    changeCount: 1,
                    lastUpdatedAt: '2026-03-23T00:11:00.000Z',
                    finalExists: false,
                    rollbackPointIds: [],
                },
            ],
            rollbackPoints: [],
            skippedPaths: [],
        }, null, 2), 'utf8');

        const saveSessionSnapshot = vi.fn().mockReturnValue({
            id: 'session_bundle_demo',
            projectRoot: importProjectDir,
            cwd: importProjectDir,
            model: 'claude-sonnet-4',
            title: 'bundle import',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-23T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 2,
            usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        });

        await runImportCommand(filePath, {
            dir: importProjectDir,
        }, {
            sessionStore: {
                getSessionSnapshot: vi.fn().mockReturnValue(null),
                saveSessionSnapshot,
            },
        });

        expect(fs.readFileSync(path.join(importProjectDir, 'src', 'imported.ts'), 'utf8')).toBe('export const importedValue = 42;\n');
        expect(fs.existsSync(path.join(importProjectDir, 'src', 'stale.ts'))).toBe(false);
        expect(saveSessionSnapshot).toHaveBeenCalledTimes(1);
        expect(saveSessionSnapshot.mock.calls[0]?.[0].session.getMetadata().fixHistory).toMatchObject({
            totalRuns: 2,
            successfulRuns: 1,
            failedRuns: 1,
            recentRuns: [{
                id: 'fix_run_1',
                success: true,
                attemptCount: 2,
            }],
        });
    });
});
