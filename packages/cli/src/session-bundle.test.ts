import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSession, FileRollbackStore } from '@xqoder/agent';
import {
    applySessionReplayBundle,
    createSessionReplayBundleDocument,
    parseSessionReplayBundleDocument,
} from './session-bundle.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

describe('session replay bundle', () => {
    it('captures final workspace state plus rollback snapshots for changed files', () => {
        const projectRoot = createTempDir('xqoder-bundle-project-');
        const rollbackDir = createTempDir('xqoder-bundle-rollbacks-');
        const filePath = path.join(projectRoot, 'src', 'app.ts');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

        const rollbackStore = new FileRollbackStore(rollbackDir);
        const rollbackPoint = rollbackStore.createPoint({
            sessionId: 'session_bundle_demo',
            projectRoot,
            toolName: 'write_file',
            filePaths: [filePath],
        });
        fs.writeFileSync(filePath, 'export const value = 2;\n', 'utf8');

        const session = new AgentSession({
            id: 'session_bundle_demo',
            title: 'Bundle Demo',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'bundle this session' },
            ],
            metadata: {
                fixHistory: {
                    totalRuns: 1,
                    successfulRuns: 1,
                    failedRuns: 0,
                    successRate: 1,
                    updatedAt: new Date('2026-03-23T00:01:00.000Z'),
                    rollingWindows: [{
                        label: '7d',
                        totalRuns: 1,
                        successfulRuns: 1,
                        failedRuns: 0,
                        successRate: 1,
                    }],
                    recentRuns: [{
                        id: 'fix_run_1',
                        success: true,
                        attemptCount: 1,
                        totalDurationMs: 1200,
                        startedAt: new Date('2026-03-23T00:00:10.000Z'),
                        completedAt: new Date('2026-03-23T00:00:11.200Z'),
                        remediationPolicyIds: ['compile-error-v1'],
                        suspectedFailureBuckets: ['runtime_compile_error'],
                        automaticActionIds: [],
                    }],
                },
            },
        });
        session.recordToolExecution({
            id: 'tool-write-1',
            name: 'write_file',
            args: { path: 'src/app.ts' },
            success: true,
            output: 'updated app.ts',
            metadata: {
                path: filePath,
                changeType: 'write',
                bytes: Buffer.byteLength('export const value = 2;\n', 'utf8'),
                rollbackPointId: rollbackPoint.id,
            },
        });

        const bundle = createSessionReplayBundleDocument({
            summary: {
                id: session.id,
                projectRoot,
                cwd: projectRoot,
                model: 'gpt-4.1',
                title: session.getTitle() ?? 'Bundle Demo',
                createdAt: session.createdAt,
                updatedAt: new Date('2026-03-23T00:02:00.000Z'),
                maxMessages: session.toSnapshot().maxMessages,
                messageCount: session.messageCount,
                usage: session.getUsage(),
                lastUserMessage: 'bundle this session',
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 1,
            },
            session,
            rollbackStore,
        });

        expect(bundle.artifactKind).toBe('xqoder-bundle');
        expect(bundle.snapshot.metadata.fixHistory).toMatchObject({
            totalRuns: 1,
            successfulRuns: 1,
        });
        expect(bundle.workspaceChanges).toEqual([
            expect.objectContaining({
                relativePath: 'src/app.ts',
                finalExists: true,
                finalContent: 'export const value = 2;\n',
                rollbackPointIds: [rollbackPoint.id],
            }),
        ]);
        expect(bundle.rollbackPoints).toEqual([
            expect.objectContaining({
                id: rollbackPoint.id,
                toolName: 'write_file',
                files: [expect.objectContaining({
                    relativePath: 'src/app.ts',
                    existedBefore: true,
                    content: 'export const value = 1;\n',
                })],
            }),
        ]);
    });

    it('parses and reapplies bundle workspace changes into another project root', () => {
        const targetProjectRoot = createTempDir('xqoder-bundle-target-');
        const bundle = parseSessionReplayBundleDocument({
            artifactKind: 'xqoder-bundle',
            bundleVersion: 1,
            schemaVersion: 1,
            exportedAt: '2026-03-23T00:10:00.000Z',
            source: { product: 'xqoder', version: '0.1.0' },
            summary: {
                id: 'session_bundle_import',
                projectRoot: '/workspace/origin',
                cwd: '/workspace/origin',
                model: 'gpt-4.1',
                title: 'Imported bundle',
                createdAt: '2026-03-23T00:00:00.000Z',
                updatedAt: '2026-03-23T00:05:00.000Z',
                maxMessages: 100,
                messageCount: 2,
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 2,
            },
            snapshot: {
                id: 'session_bundle_import',
                createdAt: '2026-03-23T00:00:00.000Z',
                maxMessages: 100,
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'import this bundle' },
                ],
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                metadata: {
                    compactions: [],
                    toolHistory: [],
                    commandHistory: [],
                    fileChanges: [],
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
                    relativePath: 'src/remove-me.ts',
                    lastChangeType: 'restore',
                    changeCount: 1,
                    lastUpdatedAt: '2026-03-23T00:11:00.000Z',
                    finalExists: false,
                    rollbackPointIds: [],
                },
            ],
            rollbackPoints: [],
            skippedPaths: [],
        });

        const deletedPath = path.join(targetProjectRoot, 'src', 'remove-me.ts');
        fs.mkdirSync(path.dirname(deletedPath), { recursive: true });
        fs.writeFileSync(deletedPath, 'delete me\n', 'utf8');

        const result = applySessionReplayBundle(bundle, targetProjectRoot);

        expect(result).toEqual({ appliedFiles: 1, deletedFiles: 1 });
        expect(fs.readFileSync(path.join(targetProjectRoot, 'src', 'imported.ts'), 'utf8')).toBe('export const importedValue = 42;\n');
        expect(fs.existsSync(deletedPath)).toBe(false);
    });
});
