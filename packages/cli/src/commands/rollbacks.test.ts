import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
    runListRollbacksCommand,
    runRestoreRollbackCommand,
    runShowRollbackCommand,
} from './rollbacks.js';

describe('rollbacks command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('lists rollback points for the current project', () => {
        runListRollbacksCommand({
            dir: '/workspace/demo',
            limit: '5',
        }, {
            rollbackStore: {
                listPoints: vi.fn().mockReturnValue([
                    {
                        id: 'rollback_2',
                        sessionId: 'session_demo',
                        projectRoot: '/workspace/demo',
                        toolName: 'apply_patch',
                        createdAt: new Date('2026-03-08T00:10:00.000Z'),
                        filePaths: ['/workspace/demo/src/index.ts'],
                    },
                ]),
                getPointDetails: vi.fn(),
                restorePoint: vi.fn(),
            },
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('rollback_2'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('files=1'));
    });

    it('shows rollback point details and file actions', () => {
        runShowRollbackCommand('rollback_2', {
            rollbackStore: {
                getPointDetails: vi.fn().mockReturnValue({
                    id: 'rollback_2',
                    sessionId: 'session_demo',
                    projectRoot: '/workspace/demo',
                    toolName: 'apply_patch',
                    createdAt: new Date('2026-03-08T00:10:00.000Z'),
                    filePaths: [
                        '/workspace/demo/src/index.ts',
                        '/workspace/demo/src/new.ts',
                    ],
                    files: [
                        {
                            path: '/workspace/demo/src/index.ts',
                            existedBefore: true,
                            content: 'console.log("old");\n',
                        },
                        {
                            path: '/workspace/demo/src/new.ts',
                            existedBefore: false,
                        },
                    ],
                }),
                listPoints: vi.fn(),
                restorePoint: vi.fn(),
            },
        });

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Tool: apply_patch'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('RESTORE_FILE'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('DELETE_ON_RESTORE'));
    });

    it('restores a rollback point manually', async () => {
        const restorePoint = vi.fn().mockReturnValue({
            id: 'rollback_2',
            sessionId: 'session_demo',
            projectRoot: '/workspace/demo',
            toolName: 'apply_patch',
            createdAt: new Date('2026-03-08T00:10:00.000Z'),
            filePaths: ['/workspace/demo/src/index.ts'],
        });

        await runRestoreRollbackCommand('rollback_2', {
            yes: true,
        }, {
            rollbackStore: {
                restorePoint,
                listPoints: vi.fn(),
                getPointDetails: vi.fn().mockReturnValue({
                    id: 'rollback_2',
                    sessionId: 'session_demo',
                    projectRoot: '/workspace/demo',
                    toolName: 'apply_patch',
                    createdAt: new Date('2026-03-08T00:10:00.000Z'),
                    filePaths: ['/workspace/demo/src/index.ts'],
                    files: [
                        {
                            path: '/workspace/demo/src/index.ts',
                            existedBefore: true,
                            content: 'console.log("old");\n',
                        },
                    ],
                }),
            },
        });

        expect(restorePoint).toHaveBeenCalledWith('rollback_2');
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('已恢复回滚点'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('rollback_2'));
    });

    it('cancels restore when interactive confirmation is declined', async () => {
        const restorePoint = vi.fn();

        await runRestoreRollbackCommand('rollback_2', {}, {
            rollbackStore: {
                restorePoint,
                listPoints: vi.fn(),
                getPointDetails: vi.fn().mockReturnValue({
                    id: 'rollback_2',
                    sessionId: 'session_demo',
                    projectRoot: '/workspace/demo',
                    toolName: 'apply_patch',
                    createdAt: new Date('2026-03-08T00:10:00.000Z'),
                    filePaths: ['/workspace/demo/src/index.ts'],
                    files: [
                        {
                            path: '/workspace/demo/src/index.ts',
                            existedBefore: true,
                            content: 'console.log("old");\n',
                        },
                    ],
                }),
            },
            isInteractiveSession: () => true,
            confirmRestore: async () => false,
        });

        expect(restorePoint).not.toHaveBeenCalled();
    });

    it('requires --yes in non-interactive environments', async () => {
        await expect(runRestoreRollbackCommand('rollback_2', {}, {
            rollbackStore: {
                restorePoint: vi.fn(),
                listPoints: vi.fn(),
                getPointDetails: vi.fn().mockReturnValue({
                    id: 'rollback_2',
                    sessionId: 'session_demo',
                    projectRoot: '/workspace/demo',
                    toolName: 'apply_patch',
                    createdAt: new Date('2026-03-08T00:10:00.000Z'),
                    filePaths: ['/workspace/demo/src/index.ts'],
                    files: [
                        {
                            path: '/workspace/demo/src/index.ts',
                            existedBefore: true,
                            content: 'console.log("old");\n',
                        },
                    ],
                }),
            },
            isInteractiveSession: () => false,
        })).rejects.toThrow('--yes');
    });
});
