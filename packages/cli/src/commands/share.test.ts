import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, FileRollbackStore } from '@xqoder/agent';
import {
    FileSessionShareStore,
    runCreateShareCommand,
    runListSharesCommand,
    runRemoveShareCommand,
    runShowShareCommand,
} from './share.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-share-'));
    tempDirs.push(dir);
    return dir;
}

describe('share command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('creates, lists, shows, and removes a local share asset', async () => {
        const shareDir = createTempDir();
        const shareStore = new FileSessionShareStore(shareDir);
        const session = new AgentSession({
            id: 'session_demo',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '帮我看下这个仓库' },
                { role: 'assistant', content: '先从目录结构开始。' },
            ],
        });
        const listSessions = vi.fn().mockReturnValue([{
            id: 'session_demo',
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'claude-sonnet-4',
            title: '帮我看下这个仓库',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
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
        }]);
        const getSessionSnapshot = vi.fn().mockReturnValue(session.toSnapshot());

        const share = await runCreateShareCommand(undefined, {
            dir: '/workspace/demo',
            format: 'markdown',
        }, {
            shareStore,
            sessionStore: {
                listSessions,
                getSessionSnapshot,
                getSessionSummary: vi.fn().mockReturnValue({
                    id: 'session_demo',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'claude-sonnet-4',
                    title: '帮我看下这个仓库',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:05:00.000Z'),
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
                }),
            },
        });

        expect(share.id).toMatch(/^share_/);
        expect(fs.existsSync(share.artifactPath)).toBe(true);
        expect(listSessions).toHaveBeenCalledWith('/workspace/demo', 1);
        expect(getSessionSnapshot).toHaveBeenCalledWith('session_demo');

        runListSharesCommand({
            dir: '/workspace/demo',
        }, {
            shareStore,
        });
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(share.id));

        const detail = runShowShareCommand(share.id, {
            shareStore,
        });
        expect(detail.artifactPath).toBe(share.artifactPath);
        expect(detail.content).toContain('# 帮我看下这个仓库');

        const removed = await runRemoveShareCommand(share.id, {
            yes: true,
        }, {
            shareStore,
        });
        expect(removed.id).toBe(share.id);
        expect(fs.existsSync(share.artifactPath)).toBe(false);
    });

    it('creates a replayable bundle share artifact with workspace changes and rollback snapshots', async () => {
        const projectDir = createTempDir();
        const shareDir = createTempDir();
        const rollbackDir = createTempDir();
        const shareStore = new FileSessionShareStore(shareDir);
        const rollbackStore = new FileRollbackStore(rollbackDir);
        const filePath = path.join(projectDir, 'src', 'bundle.ts');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'export const bundleValue = 1;\n', 'utf8');

        rollbackStore.createPoint({
            sessionId: 'session_bundle_share',
            projectRoot: projectDir,
            toolName: 'write_file',
            filePaths: [filePath],
        });
        fs.writeFileSync(filePath, 'export const bundleValue = 2;\n', 'utf8');

        const session = new AgentSession({
            id: 'session_bundle_share',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '生成 bundle' },
            ],
        });
        session.recordToolExecution({
            id: 'tool_bundle_write',
            name: 'write_file',
            args: { path: 'src/bundle.ts' },
            success: true,
            output: 'bundle updated',
            metadata: {
                path: filePath,
                changeType: 'write',
                bytes: Buffer.byteLength('export const bundleValue = 2;\n', 'utf8'),
            },
        });

        const share = await runCreateShareCommand(undefined, {
            dir: projectDir,
            format: 'bundle',
        }, {
            shareStore,
            rollbackStore,
            sessionStore: {
                listSessions: vi.fn().mockReturnValue([{
                    id: 'session_bundle_share',
                    projectRoot: projectDir,
                    cwd: projectDir,
                    model: 'gpt-4.1',
                    title: '生成 bundle',
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
                    fileChangeCount: 1,
                    lastUserMessage: '生成 bundle',
                }]),
                getSessionSnapshot: vi.fn().mockReturnValue(session.toSnapshot()),
                getSessionSummary: vi.fn().mockReturnValue({
                    id: 'session_bundle_share',
                    projectRoot: projectDir,
                    cwd: projectDir,
                    model: 'gpt-4.1',
                    title: '生成 bundle',
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
                    fileChangeCount: 1,
                    lastUserMessage: '生成 bundle',
                }),
            },
        });

        expect(share.format).toBe('bundle');
        expect(share.artifactPath).toMatch(/\.xqoder-bundle$/);
        const bundle = JSON.parse(fs.readFileSync(share.artifactPath, 'utf8')) as {
            artifactKind: string;
            workspaceChanges: Array<{ relativePath: string; finalContent?: string }>;
            rollbackPoints: Array<{ files: Array<{ relativePath: string; content?: string }> }>;
        };
        expect(bundle.artifactKind).toBe('xqoder-bundle');
        expect(bundle.workspaceChanges).toEqual([
            expect.objectContaining({
                relativePath: 'src/bundle.ts',
                finalContent: 'export const bundleValue = 2;\n',
            }),
        ]);
        expect(bundle.rollbackPoints).toEqual([
            expect.objectContaining({
                files: [expect.objectContaining({
                    relativePath: 'src/bundle.ts',
                    content: 'export const bundleValue = 1;\n',
                })],
            }),
        ]);
    });
});
