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

    it('renders status, streamed assistant output, and tool output as scrollback transcript', async () => {
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
        expect(streams.stdout.output).toContain('[tool:read_file] line one');
        expect(streams.stdout.output).toContain('[tool:read_file] partial two');
        expect(streams.stdout.output).toContain('[tool] read_file done');
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
