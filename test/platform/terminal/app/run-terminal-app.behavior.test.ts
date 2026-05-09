import { describe, expect, it } from 'bun:test';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type { AppEvent } from '@xqoder/protocol';
import type {
    AgentConversationPort,
    AgentRuntimeEvent,
    SendMessageCallbacks,
    SendMessageResult,
    TuiAgentSettings,
} from '../../../../src/application/agent/index.js';
import type { TerminalAgentRuntime } from '../../../../src/platform/terminal/app/agent-runtime.js';
import {
    runTerminalScrollbackShell,
    type TerminalShellReadline,
} from '../../../../src/platform/terminal/app/run-terminal-app.js';

const settings: TuiAgentSettings = {
    dir: '/workspace/demo',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project',
};

describe('runTerminalScrollbackShell', () => {
    it('exits on shell-local quit commands without sending a prompt to the agent', async () => {
        let sendCount = 0;
        const readline = createFakeReadline(['/quit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async () => {
                    sendCount += 1;
                    return { sessionId: 'unused' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(sendCount).toBe(0);
        expect(readline.closed).toBe(true);
    });

    it('clears the active local session on /new before sending the next prompt', async () => {
        const sentSessionIds: Array<string | undefined> = [];
        const readline = createFakeReadline(['/new', 'hello', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, sessionId, _settings, _attachments, callbacks) => {
                    sentSessionIds.push(sessionId);
                    callbacks.onEvent(createAssistantCompletedEvent('session-fresh', 'hello back'));
                    return { sessionId: 'session-fresh' };
                },
            }),
            settings,
            {
                sessionId: 'session-old',
                title: 'Existing Session',
                messages: [],
            },
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(sentSessionIds).toEqual([undefined]);
        expect(streams.stdout.output).toContain('[resumed Existing Session]');
        expect(streams.stdout.output).toContain('[new session]');
        expect(streams.stdout.output).toContain('You\n  hello');
    });

    it('renders a concise resume summary from restored conversation signals', async () => {
        const readline = createFakeReadline(['/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({}),
            settings,
            {
                sessionId: 'session-remote',
                title: 'Remote Session',
                messages: [],
                conversationSignals: [
                    { type: 'user', content: 'inspect this remote session' },
                    {
                        type: 'tool',
                        content: 'patched remote inspect payload',
                        toolCallId: 'tool-1',
                        toolName: 'write_file',
                        success: true,
                    },
                    {
                        type: 'verification',
                        content: 'Verification passed: remote inspect signals are visible',
                        ok: true,
                        blocked: false,
                        summary: 'Verification passed: remote inspect signals are visible',
                    },
                    { type: 'assistant', content: 'remote session restored' },
                ],
            },
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('[resumed Remote Session]');
        expect(streams.stdout.output).toContain('[resume] Recent conversation signals:');
        expect(streams.stdout.output).toContain('[resume:user] inspect this remote session');
        expect(streams.stdout.output).toContain('[resume:tool:write_file] patched remote inspect payload');
        expect(streams.stdout.output).toContain('[resume:verification:ok] Verification passed: remote inspect signals are visible');
        expect(streams.stdout.output).toContain('[resume:assistant] remote session restored');
    });

    it('creates a remote session on /new in attach mode before sending the next prompt', async () => {
        const sentSessionIds: Array<string | undefined> = [];
        const readline = createFakeReadline(['/new', 'hello', '/quit']);
        const streams = createStreams();
        const runtime = createRuntime({
            attachBaseUrl: 'http://example.test',
            sendMessage: async (_message, sessionId, _settings, _attachments, callbacks) => {
                sentSessionIds.push(sessionId);
                callbacks.onEvent(createAssistantCompletedEvent('session-remote', 'remote reply'));
                return { sessionId: 'session-remote' };
            },
        });

        await runTerminalScrollbackShell(
            runtime,
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
                createSession: async () => ({
                    id: 'session-remote',
                    title: 'Remote Session',
                }),
            },
        );

        expect(sentSessionIds).toEqual(['session-remote']);
        expect(streams.stdout.output).toContain('[new session Remote Session]');
    });

    it('renders status and tool progress without printing successful read output', async () => {
        const readline = createFakeReadline(['hello', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        createStatusChangedEvent('session-1', 'thinking'),
                        createStatusChangedEvent('session-1', 'thinking'),
                        {
                            type: 'message.delta',
                            sessionId: 'session-1',
                            timestamp: 1,
                            source: 'agent',
                            messageId: 'assistant-1',
                            role: 'assistant',
                            text: 'Hello from stream',
                        },
                        {
                            type: 'tool.called',
                            sessionId: 'session-1',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            args: { path: 'README.md' },
                        },
                        {
                            type: 'tool.output',
                            sessionId: 'session-1',
                            timestamp: 3,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            output: 'line one\npartial',
                            partial: true,
                        },
                        {
                            type: 'tool.output',
                            sessionId: 'session-1',
                            timestamp: 4,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            output: ' two\n',
                            partial: true,
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-1',
                            timestamp: 5,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            success: true,
                        },
                        createAssistantCompletedEvent('session-1', 'Hello from stream'),
                    ]);

                    return { sessionId: 'session-1' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect((streams.stdout.output.match(/\[thinking\]/g) ?? [])).toHaveLength(1);
        expect(streams.stdout.output).toContain('XQoder\n  Hello from stream');
        expect(streams.stdout.output).toContain('[tool] read_file {"path":"README.md"}');
        expect(streams.stdout.output).not.toContain('[tool:read_file] line one');
        expect(streams.stdout.output).not.toContain('[tool:read_file] partial two');
        expect(streams.stdout.output).toContain('[tool] read_file done');
    });

    it('does not print successful GitHub repository inspection output into the terminal transcript', async () => {
        const readline = createFakeReadline(['inspect https://github.com/paoloanzn/free-code.git', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-github',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git', maxFiles: 80 },
                        },
                        {
                            type: 'tool.output',
                            sessionId: 'session-github',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            output: [
                                '# GitHub Repository Inspection',
                                'Repository: paoloanzn/free-code',
                                '## Key evidence files',
                                '### README.md (overview)',
                            ].join('\n'),
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-github',
                            timestamp: 3,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        createAssistantCompletedEvent('session-github', '这个仓库是 free-code。'),
                    ]);

                    return { sessionId: 'session-github' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('[tool] inspect_github_repo');
        expect(streams.stdout.output).toContain('[tool] inspect_github_repo done');
        expect(streams.stdout.output).not.toContain('[tool:inspect_github_repo] # GitHub Repository Inspection');
        expect(streams.stdout.output).not.toContain('[tool:inspect_github_repo] Repository: paoloanzn/free-code');
        expect(streams.stdout.output).toContain('XQoder\n  这个仓库是 free-code。');
    });

    it('streams post-tool assistant deltas before the turn completes', async () => {
        let releaseTurn = () => {};
        const pendingTurn = new Promise<void>((resolve) => {
            releaseTurn = resolve;
        });
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();

        const shell = runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-live-after-tool',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-live-after-tool',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        {
                            type: 'message.delta',
                            sessionId: 'session-live-after-tool',
                            timestamp: 3,
                            source: 'agent',
                            messageId: 'assistant-live-after-tool',
                            role: 'assistant',
                            text: '这个仓库是 free-code，主要是 Claude Code 的可构建 CLI 分支。',
                        },
                    ]);

                    await pendingTurn;
                    return { sessionId: 'session-live-after-tool' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        await Promise.resolve();
        await Promise.resolve();
        const outputBeforeTurnCompletion = streams.stdout.output;
        releaseTurn();
        await shell;

        expect(outputBeforeTurnCompletion).toContain('[tool] inspect_github_repo done');
        expect(outputBeforeTurnCompletion).toContain('XQoder\n  这个仓库是 free-code');
    });

    it('suppresses restarted assistant text while keeping the first streamed answer visible', async () => {
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();
        const answerIntro = '我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git。';
        const firstAnswer = [
            answerIntro,
            '这是一个 TypeScript + Bun + Ink 的终端智能体项目，README 声称它移除了遥测并解锁实验功能。',
            '关键目录包括 src/bridge、src/assistant、src/cli 和 src/commands。',
            '整体看，它更像一个可构建的 Claude Code CLI 快照分支。',
            '需要我帮你继续看某个具体模块吗？',
        ].join('\n');

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-dedupe-live',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-dedupe-live',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        {
                            type: 'message.delta',
                            sessionId: 'session-dedupe-live',
                            timestamp: 3,
                            source: 'agent',
                            messageId: 'assistant-dedupe-live',
                            role: 'assistant',
                            text: `${firstAnswer}\n\n${answerIntro}`,
                        },
                        {
                            type: 'message.delta',
                            sessionId: 'session-dedupe-live',
                            timestamp: 4,
                            source: 'agent',
                            messageId: 'assistant-dedupe-live',
                            role: 'assistant',
                            text: '第二遍重复草稿，不应该继续刷到终端。',
                        },
                        createAssistantCompletedEvent('session-dedupe-live', firstAnswer),
                    ]);

                    return { sessionId: 'session-dedupe-live' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('XQoder\n  我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git。');
        expect(streams.stdout.output).toContain('整体看，它更像一个可构建的 Claude Code CLI 快照分支。');
        expect(streams.stdout.output).not.toContain('第二遍重复草稿');
        expect(streams.stdout.output.match(/我已经检查了 GitHub 仓库 https:\/\/github\.com\/paoloanzn\/free-code\.git/g)).toHaveLength(1);
    });

    it('keeps a partial restarted GitHub answer tail out of append-only scrollback', async () => {
        let releaseTurn = () => {};
        const pendingTurn = new Promise<void>((resolve) => {
            releaseTurn = resolve;
        });
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();
        const answerIntro = '我已经查看了 GitHub 仓库 https://github.com/paoloanzn/free-code.git 的详细信息。';
        const firstAnswer = [
            answerIntro,
            '这个仓库是一个 Claude Code CLI 的可构建分支，核心证据来自 README、FEATURES 和 package.json。',
            '它的终端 UI 使用 TypeScript、React 和 Ink，工具调用结果应该作为控制信号呈现。',
            'free-code 的实现还把成功 result 当成噪声忽略，只把真正的 assistant 消息提交给对话。',
            '需要继续看具体模块时，可以再指定 bridge、assistant 或 commands。',
        ].join('\n');

        const shell = runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-partial-restart',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-partial-restart',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        {
                            type: 'message.delta',
                            sessionId: 'session-partial-restart',
                            timestamp: 3,
                            source: 'agent',
                            messageId: 'assistant-partial-restart',
                            role: 'assistant',
                            text: [
                                firstAnswer,
                                '',
                                '欢迎随时告诉我！ 😊我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free',
                            ].join('\n'),
                        },
                    ]);

                    await pendingTurn;
                    callbacks.onEvent(createAssistantCompletedEvent('session-partial-restart', firstAnswer));
                    return { sessionId: 'session-partial-restart' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        await Promise.resolve();
        await Promise.resolve();
        const outputBeforeCompletion = streams.stdout.output;
        releaseTurn();
        await shell;

        expect(outputBeforeCompletion).toContain('XQoder\n  我已经查看了 GitHub 仓库 https://github.com/paoloanzn/free-code.git');
        expect(outputBeforeCompletion).toContain('free-code 的实现还把成功 result 当成噪声忽略');
        expect(outputBeforeCompletion).not.toContain('😊我已经检查了 GitHub 仓库');
        expect(outputBeforeCompletion).not.toContain('https://github.com/paoloanzn/free\n');
        expect(streams.stdout.output).not.toContain('😊我已经检查了 GitHub 仓库');
        expect(streams.stdout.output.match(/我已经(?:查看|检查)了 GitHub 仓库/g)).toHaveLength(1);
    });

    it('keeps a partial restarted repo-summary tail out when intro switches from URL to repo name', async () => {
        let releaseTurn = () => {};
        const pendingTurn = new Promise<void>((resolve) => {
            releaseTurn = resolve;
        });
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();
        const firstAnswer = [
            '`https://github.com/paoloanzn/free-code.git` 是一个开源项目，名为 **free-code**。',
            '它是一个可构建 CLI 快照分支，核心证据来自 README、FEATURES 与 package.json。',
            '如果你愿意，我可以继续展开 bridge、assistant 或 commands 模块。',
        ].join('\n');

        const shell = runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-url-to-repo-restart',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-url-to-repo-restart',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        {
                            type: 'message.delta',
                            sessionId: 'session-url-to-repo-restart',
                            timestamp: 3,
                            source: 'agent',
                            messageId: 'assistant-url-to-repo-restart',
                            role: 'assistant',
                            text: [
                                firstAnswer,
                                '',
                                '如需进一步分析某模块，欢迎继续提问。`free-code` 是一个基于 Anthropic 官方 Claude Code CLI 源码快照构建的开源终端 AI 编程助手。',
                            ].join('\n'),
                        },
                    ]);

                    await pendingTurn;
                    callbacks.onEvent(createAssistantCompletedEvent('session-url-to-repo-restart', firstAnswer));
                    return { sessionId: 'session-url-to-repo-restart' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        await Promise.resolve();
        await Promise.resolve();
        const outputBeforeCompletion = streams.stdout.output;
        releaseTurn();
        await shell;

        expect(outputBeforeCompletion).toContain('XQoder\n  `https://github.com/paoloanzn/free-code.git` 是一个开源项目');
        expect(outputBeforeCompletion).toContain('核心证据来自 README、FEATURES 与 package.json');
        expect(outputBeforeCompletion).not.toContain('`free-code` 是一个基于 Anthropic 官方');
        expect(streams.stdout.output).not.toContain('`free-code` 是一个基于 Anthropic 官方');
        expect(streams.stdout.output.match(/`https:\/\/github\.com\/paoloanzn\/free-code\.git` 是一个开源项目/g)).toHaveLength(1);
    });

    it('trims an incomplete GitHub restart tail from a completed assistant message', async () => {
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();
        const completedWithTail = [
            '我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git，这是一个名为 **free-code** 的开源项目。',
            '',
            '这个仓库强调可构建、可审计、去遥测，并保留主要 CLI 工作流。',
            '',
            '我已经查看了 GitHub',
        ].join('\n');

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-completed-tail-trim',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-completed-tail-trim',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        createAssistantCompletedEvent('session-completed-tail-trim', completedWithTail),
                    ]);

                    return { sessionId: 'session-completed-tail-trim' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('XQoder\n  我已经检查了 GitHub 仓库 https://github.com/paoloanzn/free-code.git');
        expect(streams.stdout.output).toContain('这个仓库强调可构建、可审计、去遥测');
        expect(streams.stdout.output).not.toContain('\n  我已经查看了 GitHub\n');
        expect(streams.stdout.output.match(/我已经(?:检查|查看)了 GitHub/g)).toHaveLength(1);
    });

    it('prints the returned final response when the stream misses assistant completion after a tool', async () => {
        const readline = createFakeReadline(['inspect repo', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        createStatusChangedEvent('session-returned-response', 'thinking'),
                        {
                            type: 'tool.called',
                            sessionId: 'session-returned-response',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            args: { url: 'https://github.com/paoloanzn/free-code.git' },
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-returned-response',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'inspect_github_repo',
                            success: true,
                        },
                        createStatusChangedEvent('session-returned-response', 'thinking'),
                    ]);

                    return {
                        sessionId: 'session-returned-response',
                        response: '我已经检查了仓库，这是最终返回的分析。',
                    };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('[tool] inspect_github_repo done');
        expect(streams.stdout.output).toContain('XQoder\n  我已经检查了仓库，这是最终返回的分析。');
        expect((streams.stdout.output.match(/\[thinking\]/g) ?? [])).toHaveLength(2);
        expect(streams.stdout.output).not.toContain('(No response)');
    });

    it('keeps non-read tool output visible in the scrollback transcript', async () => {
        const readline = createFakeReadline(['apply a patch', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-write',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'write_file',
                            args: { path: 'src/demo.ts' },
                        },
                        {
                            type: 'tool.output',
                            sessionId: 'session-write',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'write_file',
                            output: 'Wrote src/demo.ts\n',
                            partial: true,
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-write',
                            timestamp: 3,
                            source: 'tool',
                            provider: 'local',
                            tool: 'write_file',
                            success: true,
                        },
                        createAssistantCompletedEvent('session-write', 'patch applied'),
                    ]);

                    return { sessionId: 'session-write' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('[tool] write_file {"path":"src/demo.ts"}');
        expect(streams.stdout.output).toContain('[tool:write_file] Wrote src/demo.ts');
        expect(streams.stdout.output).toContain('[tool] write_file done');
    });

    it('renders failed tool output before the failed completion note', async () => {
        const readline = createFakeReadline(['inspect big file', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'tool.called',
                            sessionId: 'session-tool-failed',
                            timestamp: 1,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            args: { path: '/tmp/code.html' },
                        },
                        {
                            type: 'tool.output',
                            sessionId: 'session-tool-failed',
                            timestamp: 2,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            output: 'Error: File is too large to read fully. Use startLine/endLine.',
                        },
                        {
                            type: 'tool.completed',
                            sessionId: 'session-tool-failed',
                            timestamp: 3,
                            source: 'tool',
                            provider: 'local',
                            tool: 'read_file',
                            success: false,
                        },
                        createAssistantCompletedEvent('session-tool-failed', 'will retry with a range'),
                    ]);

                    return { sessionId: 'session-tool-failed' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        const output = streams.stdout.output;
        expect(output).toContain('[tool:read_file] Error: File is too large to read fully');
        expect(output).toContain('[tool] read_file failed');
        expect(output.indexOf('[tool:read_file] Error: File is too large')).toBeLessThan(
            output.indexOf('[tool] read_file failed'),
        );
    });

    it('renders usage statistics after the assistant response completes', async () => {
        const readline = createFakeReadline(['hello', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (_message, _sessionId, _settings, _attachments, callbacks) => {
                    emitEvents(callbacks, [
                        {
                            type: 'message.delta',
                            sessionId: 'session-usage',
                            timestamp: 1,
                            source: 'agent',
                            messageId: 'assistant-usage',
                            role: 'assistant',
                            text: 'Usage-aware response',
                        },
                        {
                            type: 'usage',
                            sessionId: 'session-usage',
                            timestamp: 2,
                            source: 'agent',
                            model: 'gpt-4.1',
                            promptTokens: 21,
                            completionTokens: 4,
                            totalTokens: 25,
                            cost: 0.45,
                        },
                        createAssistantCompletedEvent('session-usage', 'Usage-aware response'),
                    ]);

                    return { sessionId: 'session-usage' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(streams.stdout.output).toContain('XQoder\n  Usage-aware response');
        expect(streams.stdout.output).toContain('[usage] gpt-4.1 prompt=21 completion=4 total=25 cost=$0.45');
    });

    it('forwards /plan prompts to the agent service without shell-local rewriting', async () => {
        const sentMessages: string[] = [];
        const readline = createFakeReadline(['/plan stabilize conversation engine slice 1', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (message, _sessionId, _settings, _attachments, callbacks) => {
                    sentMessages.push(message);
                    callbacks.onEvent(createAssistantCompletedEvent('session-plan', 'planning reply'));
                    return { sessionId: 'session-plan' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toBe('/plan stabilize conversation engine slice 1');
        expect(streams.stdout.output).toContain('You\n  /plan stabilize conversation engine slice 1');
    });

    it('routes /compact through the shared direct-command path instead of the shell-local compaction branch', async () => {
        let compactCount = 0;
        let sendCount = 0;
        const readline = createFakeReadline(['/compact', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                compactSession: async () => {
                    compactCount += 1;
                    return 'Compacted summary';
                },
                sendMessage: async (message, sessionId, _settings, _attachments, callbacks) => {
                    sendCount += 1;
                    expect(message).toBe('/compact');
                    expect(sessionId).toBe('session-existing');
                    emitEvents(callbacks, [
                        createStatusChangedEvent('session-existing', 'thinking'),
                        createAssistantCompletedEvent('session-existing', 'Compacted summary'),
                        createStatusChangedEvent('session-existing', 'done'),
                    ]);
                    return { sessionId: 'session-existing' };
                },
            }),
            settings,
            {
                sessionId: 'session-existing',
                title: 'Existing Session',
                messages: [],
            },
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(compactCount).toBe(0);
        expect(sendCount).toBe(1);
        expect(streams.stdout.output).toContain('You\n  /compact');
        expect(streams.stdout.output).toContain('XQoder\n  Compacted summary');
    });

    it('routes /status through the shared TUI direct-command path without creating a fake active session', async () => {
        const sentSessionIds: Array<string | undefined> = [];
        const readline = createFakeReadline(['/status', 'hello', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (message, sessionId, _settings, _attachments, callbacks) => {
                    sentSessionIds.push(sessionId);
                    if (message === '/status') {
                        emitEvents(callbacks, [
                            createStatusChangedEvent('direct:status', 'thinking'),
                            createAssistantCompletedEvent(
                                'direct:status',
                                [
                                    'Runtime status:',
                                    'session=new',
                                    'cwd=/workspace/demo',
                                    'agent=general',
                                ].join('\n'),
                            ),
                            createStatusChangedEvent('direct:status', 'done'),
                        ]);
                        return { sessionId: 'direct:status' };
                    }

                    callbacks.onEvent(createAssistantCompletedEvent('session-real', 'hello back'));
                    return { sessionId: 'session-real' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(sentSessionIds).toEqual([undefined, undefined]);
        expect(streams.stdout.output).toContain('You\n  /status');
        expect(streams.stdout.output).toContain('XQoder\n  Runtime status:');
        expect(streams.stdout.output).toContain('  session=new');
        expect(streams.stdout.output).toContain('You\n  hello');
        expect(streams.stdout.output).toContain('XQoder\n  hello back');
    });

    it('routes /permissions through the shared TUI direct-command path', async () => {
        const sentMessages: string[] = [];
        const readline = createFakeReadline(['/permissions', '/exit']);
        const streams = createStreams();

        await runTerminalScrollbackShell(
            createRuntime({
                sendMessage: async (message, _sessionId, _settings, _attachments, callbacks) => {
                    sentMessages.push(message);
                    emitEvents(callbacks, [
                        createStatusChangedEvent('direct:permissions', 'thinking'),
                        createAssistantCompletedEvent(
                            'direct:permissions',
                            [
                                'cwd=/workspace/demo',
                                'sandboxMode=project',
                                'effectiveDefaultMode=ask',
                                'effectiveTools=-',
                                'rules=-',
                            ].join('\n'),
                        ),
                        createStatusChangedEvent('direct:permissions', 'done'),
                    ]);
                    return { sessionId: 'direct:permissions' };
                },
            }),
            settings,
            undefined,
            {},
            streams,
            {
                createReadlineInterface: () => readline,
            },
        );

        expect(sentMessages).toEqual(['/permissions']);
        expect(streams.stdout.output).toContain('You\n  /permissions');
        expect(streams.stdout.output).toContain('XQoder\n  cwd=/workspace/demo');
        expect(streams.stdout.output).toContain('  effectiveDefaultMode=ask');
    });
});

function createRuntime(overrides: {
    attachBaseUrl?: string;
    compactSession?: AgentConversationPort['compactSession'];
    sendMessage?: AgentConversationPort['sendMessage'];
}): TerminalAgentRuntime {
    const agentService: AgentConversationPort = {
        isBusy: false,
        cancel() {},
        async compactSession(sessionId, activeSettings) {
            return overrides.compactSession
                ? await overrides.compactSession(sessionId, activeSettings)
                : null;
        },
        async sendMessage(message, sessionId, activeSettings, attachments, callbacks): Promise<SendMessageResult> {
            return overrides.sendMessage
                ? await overrides.sendMessage(message, sessionId, activeSettings, attachments, callbacks)
                : { sessionId: sessionId ?? 'session-1' };
        },
        async dispose() {},
    };

    return {
        attachBaseUrl: overrides.attachBaseUrl,
        agentService,
        sessionStore: null,
    };
}

function createFakeReadline(answers: string[]): TerminalShellReadline & { closed: boolean } {
    let index = 0;
    return {
        closed: false,
        async question() {
            const answer = answers[index] ?? '/exit';
            index += 1;
            return answer;
        },
        close() {
            this.closed = true;
        },
    };
}

function createStreams(): {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream & { output: string };
    stderr: NodeJS.WriteStream & { output: string };
} {
    const stdout = createWritableRecorder();
    const stderr = createWritableRecorder();
    return {
        stdin: {} as NodeJS.ReadStream,
        stdout,
        stderr,
    };
}

function createWritableRecorder(): NodeJS.WriteStream & { output: string } {
    return {
        output: '',
        write(chunk: string | Uint8Array) {
            this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
            return true;
        },
    } as NodeJS.WriteStream & { output: string };
}

function emitEvents(callbacks: SendMessageCallbacks, events: Array<AgentRuntimeEvent | AppEvent>): void {
    events.forEach((event) => {
        callbacks.onEvent(toAgentRuntimeEvent(event));
    });
}

function createStatusChangedEvent(sessionId: string, status: 'thinking' | 'done'): AgentRuntimeEvent {
    return toAgentRuntimeEvent({
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        status,
    } as AppEvent);
}

function createAssistantCompletedEvent(sessionId: string, content: string): AgentRuntimeEvent {
    return toAgentRuntimeEvent({
        type: 'message.completed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        message: {
            id: `assistant:${sessionId}`,
            sessionId,
            role: 'assistant',
            content,
            createdAt: Date.now(),
        },
    } as AppEvent);
}

function toAgentRuntimeEvent(event: AgentRuntimeEvent | AppEvent): AgentRuntimeEvent {
    if ('payload' in event) {
        return event;
    }

    return createConversationEventEnvelopeEmitter(
        event.sessionId,
        `${event.sessionId}:turn:test`,
    ).emit(event) as AgentRuntimeEvent;
}
