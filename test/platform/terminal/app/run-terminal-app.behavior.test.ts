import { describe, expect, it } from 'bun:test';
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
});

function createRuntime(overrides: {
    attachBaseUrl?: string;
    sendMessage?: AgentConversationPort['sendMessage'];
}): TerminalAgentRuntime {
    const agentService: AgentConversationPort = {
        isBusy: false,
        cancel() {},
        async compactSession() {
            return null;
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

function emitEvents(callbacks: SendMessageCallbacks, events: AgentRuntimeEvent[]): void {
    events.forEach((event) => {
        callbacks.onEvent(event);
    });
}

function createStatusChangedEvent(sessionId: string, status: 'thinking' | 'done'): AgentRuntimeEvent {
    return {
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        status,
    };
}

function createAssistantCompletedEvent(sessionId: string, content: string): AgentRuntimeEvent {
    return {
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
    };
}
