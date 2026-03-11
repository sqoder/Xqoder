import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { FileSessionShareStore } from '../commands/share.js';
import {
    buildTuiActionFeedback,
    buildTuiResumeResult,
    buildTuiSessionDetail,
    buildTuiSessionList,
    buildTuiShareCreateResult,
    buildTuiShareList,
    buildTuiShareRemove,
    buildTuiShareShow,
} from './session-actions.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-tui-share-'));
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

describe('tui session actions', () => {
    it('builds unified feedback messages for copy share export and unshare actions', () => {
        expect(buildTuiActionFeedback('copy')).toEqual({
            infoMessage: 'Copy → latest response',
            systemMessage: 'Copied latest AI response to clipboard.',
        });
        expect(buildTuiActionFeedback('copy_session', { count: 4 })).toEqual({
            infoMessage: 'Copy → session',
            systemMessage: 'Copied session transcript to clipboard (4 chat messages).',
        });
        expect(buildTuiActionFeedback('copy_code', { count: 2 })).toEqual({
            infoMessage: 'Copy → code (2)',
            systemMessage: 'Copied 2 code block(s) to clipboard.',
        });
        expect(buildTuiActionFeedback('export_md', { target: 'export-1.md' })).toEqual({
            infoMessage: 'Export → export-1.md',
            systemMessage: 'Exported current session as Markdown: export-1.md',
        });
        expect(buildTuiActionFeedback('share_create', { id: 'share_1' })).toEqual({
            infoMessage: 'Share → share_1',
            systemMessage: 'Created local share share_1.',
        });
        expect(buildTuiActionFeedback('share_remove', { id: 'share_1' })).toEqual({
            infoMessage: 'Share removed → share_1',
            systemMessage: 'Removed local share share_1.',
        });
        expect(buildTuiActionFeedback('unshare', { count: 3 })).toEqual({
            infoMessage: 'Unshare → 3 removed',
            systemMessage: 'Removed 3 local share(s) linked to the current session.',
        });
    });

    it('builds recent session lines with an active marker', () => {
        const result = buildTuiSessionList({
            listSessions: vi.fn().mockReturnValue([
                {
                    id: 'session_1',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'qwen-plus',
                    title: '分析目录结构',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                    maxMessages: 100,
                    messageCount: 5,
                    usage: {
                        promptTokens: 10,
                        completionTokens: 4,
                        totalTokens: 14,
                    },
                    compactionCount: 0,
                    commandCount: 1,
                    fileChangeCount: 0,
                },
            ]),
        }, '/workspace/demo', 'session_1');

        expect(result.lines.join('\n')).toContain('* [1] session_1');
        expect(result.lines.join('\n')).toContain('/resume <编号>');
    });

    it('resolves a resumed session and returns detail lines', () => {
        const session = new AgentSession({
            id: 'session_1',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '继续看看项目' },
                { role: 'assistant', content: '先看一下最近修改。' },
            ],
        });

        const result = buildTuiResumeResult({
            findLatestSession: vi.fn().mockReturnValue(session),
            getSession: vi.fn().mockReturnValue(session),
            listSessions: vi.fn().mockReturnValue([
                {
                    id: 'session_1',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'qwen-plus',
                    title: '继续看看项目',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                    maxMessages: 100,
                    messageCount: 3,
                    usage: {
                        promptTokens: 10,
                        completionTokens: 4,
                        totalTokens: 14,
                    },
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                    lastUserMessage: '继续看看项目',
                },
            ]),
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_1',
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'qwen-plus',
                title: '继续看看项目',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 10,
                    completionTokens: 4,
                    totalTokens: 14,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
                lastUserMessage: '继续看看项目',
            }),
        }, '/workspace/demo');

        expect(result.sessionId).toBe('session_1');
        expect(result.lines.join('\n')).toContain('已切换当前会话: session_1');
        expect(result.lines.join('\n')).toContain('Recent Transcript:');
    });

    it('supports resuming a session by list index', () => {
        const session1 = new AgentSession({
            id: 'session_1',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '会话一' },
                { role: 'assistant', content: 'first' },
            ],
        });
        const session2 = new AgentSession({
            id: 'session_2',
            createdAt: new Date('2026-03-08T00:01:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '会话二' },
                { role: 'assistant', content: 'second' },
            ],
        });
        const getSession = vi.fn((sessionId: string) => (
            sessionId === 'session_1' ? session1 : sessionId === 'session_2' ? session2 : null
        ));
        const getSessionSummary = vi.fn((sessionId: string) => ({
            id: sessionId,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'qwen-plus',
            title: sessionId === 'session_1' ? '会话一' : '会话二',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:10:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: {
                promptTokens: 10,
                completionTokens: 4,
                totalTokens: 14,
            },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
            lastUserMessage: sessionId === 'session_1' ? '会话一' : '会话二',
        }));

        const result = buildTuiResumeResult({
            findLatestSession: vi.fn().mockReturnValue(session1),
            getSession,
            listSessions: vi.fn().mockReturnValue([
                getSessionSummary('session_1'),
                getSessionSummary('session_2'),
            ]),
            getSessionSummary,
        }, '/workspace/demo', undefined, '2');

        expect(result.sessionId).toBe('session_2');
        expect(result.lines.join('\n')).toContain('已切换当前会话: session_2');
    });

    it('builds session detail lines with transcript and timeline guidance', () => {
        const session = new AgentSession({
            id: 'session_1',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '继续看看项目' },
                { role: 'assistant', content: '先看一下最近修改。' },
            ],
        });
        session.recordToolExecution({
            id: 'tool_cmd',
            name: 'run_command',
            args: { command: 'pnpm test' },
            success: true,
            output: 'tests passed',
            completedAt: new Date('2026-03-08T00:03:00.000Z'),
            metadata: {
                command: 'pnpm test',
                cwd: '/workspace/demo',
            },
        });
        session.recordToolExecution({
            id: 'tool_write',
            name: 'write_file',
            args: { path: 'src/app.tsx', content: 'export {}' },
            success: true,
            output: 'file written',
            completedAt: new Date('2026-03-08T00:04:00.000Z'),
            metadata: {
                path: '/workspace/demo/src/app.tsx',
                changeType: 'write',
                bytes: 128,
            },
        });
        session.recordToolExecution({
            id: 'tool_read',
            name: 'Read',
            args: { file_path: 'src/app.tsx' },
            success: true,
            output: 'component source',
            completedAt: new Date('2026-03-08T00:05:00.000Z'),
        });

        const result = buildTuiSessionDetail({
            findLatestSession: vi.fn().mockReturnValue(session),
            getSession: vi.fn().mockReturnValue(session),
            listSessions: vi.fn().mockReturnValue([]),
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_1',
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'qwen-plus',
                title: '继续看看项目',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 10,
                    completionTokens: 4,
                    totalTokens: 14,
                },
                compactionCount: 0,
                commandCount: 1,
                fileChangeCount: 1,
                lastUserMessage: '继续看看项目',
            }),
        }, '/workspace/demo');

        expect(result.lines.join('\n')).toContain('Recent Transcript:');
        expect(result.lines.join('\n')).toContain('Command History:');
        expect(result.lines.join('\n')).toContain('File Changes:');
        expect(result.lines.join('\n')).toContain('Tool History:');
        expect(result.lines.join('\n')).toContain('/details');
        expect(result.lines.join('\n')).toContain('/diff');
    });

    it('adds follow-up guidance to share actions', () => {
        const shareStore = {
            listShares: vi.fn().mockReturnValue([
                {
                    id: 'share_1',
                    sessionId: 'session_1',
                    projectRoot: '/workspace/demo',
                    title: '继续看看项目',
                    artifactPath: '/tmp/share_1.md',
                    createdAt: new Date('2026-03-08T00:10:00.000Z'),
                },
            ]),
            getShare: vi.fn().mockReturnValue({
                id: 'share_1',
                sessionId: 'session_1',
                projectRoot: '/workspace/demo',
                title: '继续看看项目',
                artifactPath: '/tmp/share_1.md',
                createdAt: new Date('2026-03-08T00:10:00.000Z'),
                content: '# share',
                format: 'markdown',
            }),
            removeShare: vi.fn().mockReturnValue({
                id: 'share_1',
                sessionId: 'session_1',
                projectRoot: '/workspace/demo',
                title: '继续看看项目',
                artifactPath: '/tmp/share_1.md',
                createdAt: new Date('2026-03-08T00:10:00.000Z'),
            }),
        } as unknown as FileSessionShareStore;

        expect(buildTuiShareList(shareStore, '/workspace/demo').lines.join('\n')).toContain('/share show <id>');
        expect(buildTuiShareShow(shareStore, 'share_1').lines.join('\n')).toContain('/share remove share_1');
        expect(buildTuiShareRemove(shareStore, 'share_1').lines.join('\n')).toContain('/share list');
    });

    it('creates, lists, shows, and removes a local share asset', () => {
        const shareStore = new FileSessionShareStore(createTempDir());
        const session = new AgentSession({
            id: 'session_1',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '继续看看项目' },
                { role: 'assistant', content: '先看一下最近修改。' },
            ],
        });
        const sessionStore = {
            findLatestSession: vi.fn().mockReturnValue(session),
            getSession: vi.fn().mockReturnValue(session),
            listSessions: vi.fn().mockReturnValue([
                {
                    id: 'session_1',
                    projectRoot: '/workspace/demo',
                    cwd: '/workspace/demo',
                    model: 'qwen-plus',
                    title: '继续看看项目',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                    maxMessages: 100,
                    messageCount: 3,
                    usage: {
                        promptTokens: 10,
                        completionTokens: 4,
                        totalTokens: 14,
                    },
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                    lastUserMessage: '继续看看项目',
                },
            ]),
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_1',
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'qwen-plus',
                title: '继续看看项目',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:10:00.000Z'),
                maxMessages: 100,
                messageCount: 3,
                usage: {
                    promptTokens: 10,
                    completionTokens: 4,
                    totalTokens: 14,
                },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
                lastUserMessage: '继续看看项目',
            }),
        };

        const created = buildTuiShareCreateResult(
            sessionStore,
            shareStore,
            '/workspace/demo',
            'session_1',
        );
        expect(created.lines.join('\n')).toContain('已为当前会话创建本地 share');

        const listed = buildTuiShareList(shareStore, '/workspace/demo');
        expect(listed.lines.join('\n')).toContain(created.share.id);

        const shown = buildTuiShareShow(shareStore, created.share.id);
        expect(shown.lines.join('\n')).toContain(created.share.artifactPath);

        const removed = buildTuiShareRemove(shareStore, created.share.id);
        expect(removed.lines.join('\n')).toContain(`已删除本地 share: ${created.share.id}`);
    });
});
