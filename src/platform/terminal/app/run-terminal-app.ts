import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { ConfigManager, LogLevel, logger, resolveConfigWithEnvOverrides, type SandboxMode } from '@xqoder/shared';
import type {
    AgentRunStatus,
    AgentRuntimeEvent,
    TuiAgentSettings,
} from '../../../application/agent/index.js';
import {
    createTerminalAgentRuntime,
    createTerminalSession,
    disposeTerminalAgentRuntime,
    restoreTerminalAgentSession,
    type TerminalAgentRuntime,
    type TerminalSessionSnapshot,
} from './agent-runtime.js';

export interface TerminalAppOptions {
    dir?: string;
    model?: string;
    agent?: string;
    sandboxMode?: SandboxMode;
    continue?: boolean;
    session?: string;
    prompt?: string;
    /** Connect to remote serve (attach mode), TUI sends messages via HTTP */
    attachBaseUrl?: string;
}

const TERMINAL_INLINE_EVENT_MAX_LENGTH = 160;
const TERMINAL_INLINE_OUTPUT_MAX_LENGTH = 240;

interface TerminalStreamingBlockState {
    open: boolean;
    atLineStart: boolean;
    wroteContent: boolean;
}

interface TerminalToolOutputState {
    tool: string;
    buffer: string;
    sawPartial: boolean;
}

export const TERMINAL_LOCAL_COMMANDS = {
    exit: ['/quit', '/exit'],
    new: ['/new', '/session new'],
} as const;

export type TerminalLocalCommand = keyof typeof TERMINAL_LOCAL_COMMANDS;

const TERMINAL_LOCAL_COMMAND_LOOKUP = new Map<string, TerminalLocalCommand>(
    Object.entries(TERMINAL_LOCAL_COMMANDS).flatMap(([command, aliases]) =>
        aliases.map((alias) => [alias, command as TerminalLocalCommand]),
    ),
);

export function resolveTerminalLocalCommand(prompt: string): TerminalLocalCommand | null {
    const trimmed = prompt.trim();
    return TERMINAL_LOCAL_COMMAND_LOOKUP.get(trimmed) ?? null;
}

function resolveSettings(options: TerminalAppOptions): TuiAgentSettings {
    const resolvedDir = path.resolve(options.dir ?? process.cwd());
    const loadedConfig = new ConfigManager().load({ cwd: resolvedDir });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);

    return {
        dir: resolvedDir,
        model: options.model ?? config.llm.model,
        agent: options.agent ?? config.defaultAgent ?? 'general',
        sandboxMode: options.sandboxMode ?? config.sandbox?.mode ?? 'project',
    };
}

function installTerminalNoiseGuards(): () => void {
    const originalEmitWarning = process.emitWarning.bind(process);
    const originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };

    logger.setLevel(LogLevel.Silent);
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    console.log = (() => undefined) as typeof console.log;
    console.info = (() => undefined) as typeof console.info;
    console.warn = (() => undefined) as typeof console.warn;
    console.error = (() => undefined) as typeof console.error;

    return () => {
        process.emitWarning = originalEmitWarning;
        console.log = originalConsole.log;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        logger.setLevel(LogLevel.Info);
    };
}

function writeConversationBlock(
    stdout: NodeJS.WriteStream,
    header: string,
    content: string,
): void {
    stdout.write(`${header}\n`);
    const lines = content.length > 0 ? content.split('\n') : [''];
    for (const line of lines) {
        stdout.write(`  ${line}\n`);
    }
    stdout.write('\n');
}

export function truncateTerminalInlineText(text: string, maxLength = TERMINAL_INLINE_EVENT_MAX_LENGTH): string {
    if (maxLength <= 0) return '';
    if (text.length <= maxLength) return text;
    if (maxLength === 1) return '…';
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatTerminalInlineValue(value: unknown, maxLength = TERMINAL_INLINE_EVENT_MAX_LENGTH): string {
    const raw = (() => {
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    })();

    const normalized = raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
    return truncateTerminalInlineText(normalized, maxLength);
}

export function splitTerminalOutputBuffer(buffer: string, flush = false): { lines: string[]; rest: string } {
    const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');
    if (flush) {
        const lines = parts.at(-1) === '' ? parts.slice(0, -1) : parts;
        return { lines, rest: '' };
    }
    return {
        lines: parts.slice(0, -1),
        rest: parts.at(-1) ?? '',
    };
}

function ensureStreamingConversationBlock(
    stdout: NodeJS.WriteStream,
    header: string,
    state: TerminalStreamingBlockState,
): void {
    if (state.open) {
        return;
    }
    stdout.write(`${header}\n`);
    state.open = true;
    state.atLineStart = true;
    state.wroteContent = false;
}

function writeStreamingConversationChunk(
    stdout: NodeJS.WriteStream,
    header: string,
    state: TerminalStreamingBlockState,
    text: string,
): void {
    if (!text) {
        return;
    }

    ensureStreamingConversationBlock(stdout, header, state);
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (const character of normalized) {
        if (state.atLineStart) {
            stdout.write('  ');
        }
        stdout.write(character);
        state.wroteContent = true;
        state.atLineStart = character === '\n';
    }
}

function finishStreamingConversationBlock(
    stdout: NodeJS.WriteStream,
    state: TerminalStreamingBlockState,
): void {
    if (!state.open) {
        return;
    }

    if (!state.wroteContent) {
        stdout.write('  \n\n');
    } else {
        if (!state.atLineStart) {
            stdout.write('\n');
        }
        stdout.write('\n');
    }

    state.open = false;
    state.atLineStart = true;
    state.wroteContent = false;
}

function writeTerminalInlineNote(stdout: NodeJS.WriteStream, note: string): void {
    stdout.write(`${note}\n`);
}

function getTerminalToolKey(event: { provider: string; tool: string }): string {
    return `${event.provider}:${event.tool}`;
}

function shouldShowToolArgs(args: unknown): boolean {
    if (args == null) {
        return false;
    }
    if (typeof args === 'string') {
        return args.trim().length > 0;
    }
    if (Array.isArray(args)) {
        return args.length > 0;
    }
    if (typeof args === 'object') {
        return Object.keys(args as Record<string, unknown>).length > 0;
    }
    return true;
}

function formatTerminalStatusNote(
    status: AgentRunStatus,
    hasAnnouncedThinking: boolean,
): string | null {
    if (status === 'thinking' && !hasAnnouncedThinking) {
        return '[thinking]';
    }
    if (status === 'awaiting-approval') {
        return '[approval] waiting for input';
    }
    return null;
}

async function runTerminalScrollbackShell(
    runtime: TerminalAgentRuntime,
    settings: TuiAgentSettings,
    restoredSession: TerminalSessionSnapshot | undefined,
    options: TerminalAppOptions,
    streams: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
): Promise<void> {
    const { stdin, stdout } = streams;
    const agentService = runtime.agentService;
    const rl = readline.createInterface({
        input: stdin,
        output: stdout,
        terminal: true,
    });

    let activeSessionId = restoredSession?.sessionId;

    try {
        if (restoredSession?.sessionId) {
            stdout.write(`[resumed ${restoredSession.title ?? restoredSession.sessionId}]\n\n`);
        }

        const askApproval = async (summary: string): Promise<boolean> => {
            const answer = await rl.question(`[approval] ${summary} [y/N] `);
            return /^y(es)?$/i.test(answer.trim());
        };

        const askQuestion = async (request: { requestId: string; question: string; options: Array<{ label: string }> }) => {
            stdout.write(`[question] ${request.question}\n`);
            request.options.forEach((option, index) => {
                stdout.write(`  ${index + 1}. ${option.label}\n`);
            });
            const answer = await rl.question('Select option number: ');
            const selectedIndex = Math.max(0, Math.min(request.options.length - 1, Number.parseInt(answer.trim(), 10) - 1 || 0));
            return {
                requestId: request.requestId,
                selected: [request.options[selectedIndex]!.label],
            };
        };

        const sendPrompt = async (prompt: string): Promise<void> => {
            const trimmed = prompt.trim();
            if (!trimmed) return;

            const localCommand = resolveTerminalLocalCommand(trimmed);

            if (localCommand === 'exit') {
                throw new Error('__XQODER_EXIT__');
            }

            if (localCommand === 'new') {
                if (runtime.attachBaseUrl) {
                    const created = await createTerminalSession(runtime, settings.dir);
                    activeSessionId = created.id;
                    stdout.write(`[new session ${created.title}]\n\n`);
                } else {
                    activeSessionId = undefined;
                    stdout.write('[new session]\n\n');
                }
                return;
            }

            writeConversationBlock(stdout, 'You', trimmed);

            let assistantReply = '';
            let assistantStreamed = false;
            let assistantDelivered = false;
            let announcedThinking = false;
            const assistantStream: TerminalStreamingBlockState = {
                open: false,
                atLineStart: true,
                wroteContent: false,
            };
            const toolOutputs = new Map<string, TerminalToolOutputState>();

            const flushToolOutput = (toolState: TerminalToolOutputState, flush: boolean): void => {
                const { lines, rest } = splitTerminalOutputBuffer(toolState.buffer, flush);
                toolState.buffer = rest;
                if (lines.length === 0) {
                    return;
                }

                finishStreamingConversationBlock(stdout, assistantStream);
                for (const line of lines) {
                    writeTerminalInlineNote(
                        stdout,
                        `[tool:${toolState.tool}] ${truncateTerminalInlineText(line, TERMINAL_INLINE_OUTPUT_MAX_LENGTH)}`,
                    );
                }
            };

            const flushPendingOutput = (): void => {
                finishStreamingConversationBlock(stdout, assistantStream);
                for (const toolState of toolOutputs.values()) {
                    flushToolOutput(toolState, true);
                }
            };

            const handleAssistantEvent = (event: AgentRuntimeEvent): void => {
                if (event.type === 'message.delta' && event.role === 'assistant') {
                    assistantStreamed = true;
                    assistantReply += event.text;
                    writeStreamingConversationChunk(stdout, 'XQoder', assistantStream, event.text);
                    return;
                }

                if (event.type === 'message.completed' && event.message.role === 'assistant') {
                    assistantReply = event.message.content;
                    if (assistantStreamed) {
                        finishStreamingConversationBlock(stdout, assistantStream);
                    } else {
                        writeConversationBlock(stdout, 'XQoder', assistantReply || '(No response)');
                    }
                    assistantDelivered = true;
                }
            };

            const handleToolEvent = (event: AgentRuntimeEvent): void => {
                if (event.type === 'tool.called') {
                    finishStreamingConversationBlock(stdout, assistantStream);
                    const key = getTerminalToolKey(event);
                    toolOutputs.set(key, {
                        tool: event.tool,
                        buffer: '',
                        sawPartial: false,
                    });
                    const argsSummary = shouldShowToolArgs(event.args)
                        ? ` ${formatTerminalInlineValue(event.args, TERMINAL_INLINE_EVENT_MAX_LENGTH)}`
                        : '';
                    writeTerminalInlineNote(stdout, `[tool] ${event.tool}${argsSummary}`);
                    return;
                }

                if (event.type === 'tool.output') {
                    const key = getTerminalToolKey(event);
                    const toolState = toolOutputs.get(key) ?? {
                        tool: event.tool,
                        buffer: '',
                        sawPartial: false,
                    };
                    toolOutputs.set(key, toolState);

                    if (event.partial) {
                        toolState.sawPartial = true;
                        toolState.buffer += event.output;
                        flushToolOutput(toolState, false);
                        return;
                    }

                    if (!toolState.sawPartial) {
                        toolState.buffer += event.output;
                        flushToolOutput(toolState, true);
                    }
                    return;
                }

                if (event.type === 'tool.completed') {
                    const key = getTerminalToolKey(event);
                    const toolState = toolOutputs.get(key) ?? {
                        tool: event.tool,
                        buffer: '',
                        sawPartial: false,
                    };
                    flushToolOutput(toolState, true);
                    toolOutputs.delete(key);
                    writeTerminalInlineNote(stdout, `[tool] ${event.tool} ${event.success ? 'done' : 'failed'}`);
                }
            };

            const sendSettings = { ...settings };
            const result = await agentService.sendMessage(trimmed, activeSessionId, sendSettings, [], {
                onEvent: (event) => {
                    handleAssistantEvent(event);
                    handleToolEvent(event);

                    if (event.type === 'status.changed') {
                        const note = formatTerminalStatusNote(event.status, announcedThinking);
                        if (note) {
                            finishStreamingConversationBlock(stdout, assistantStream);
                            writeTerminalInlineNote(stdout, note);
                            if (event.status === 'thinking') {
                                announcedThinking = true;
                            }
                        }
                        return;
                    }

                    if (event.type === 'error') {
                        flushPendingOutput();
                        assistantReply = `Error: ${event.message}`;
                        writeConversationBlock(stdout, 'XQoder', assistantReply);
                        assistantDelivered = true;
                    }
                },
                onToolApproval: async (request) => {
                    flushPendingOutput();
                    return askApproval(request.summary);
                },
                onQuestion: async (request) => {
                    flushPendingOutput();
                    return askQuestion(request);
                },
            });

            activeSessionId = result.sessionId;
            flushPendingOutput();
            if (!assistantDelivered) {
                writeConversationBlock(stdout, 'XQoder', assistantReply || '(No response)');
            }
        };

        if (options.prompt?.trim()) {
            try {
                await sendPrompt(options.prompt);
            } catch (error) {
                if (error instanceof Error && error.message === '__XQODER_EXIT__') {
                    return;
                }
                throw error;
            }
        }

        while (true) {
            const prompt = await rl.question('> ');
            try {
                await sendPrompt(prompt);
            } catch (error) {
                if (error instanceof Error && error.message === '__XQODER_EXIT__') {
                    break;
                }
                throw error;
            }
        }
    } finally {
        rl.close();
    }
}

export async function runTerminalApp(
    options: TerminalAppOptions = {},
    streams: {
        stdin?: NodeJS.ReadStream;
        stdout?: NodeJS.WriteStream;
        stderr?: NodeJS.WriteStream;
    } = {},
): Promise<void> {
    const stdin = streams.stdin ?? process.stdin;
    const stdout = streams.stdout ?? process.stdout;
    const stderr = streams.stderr ?? process.stderr;

    if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
        stderr.write('[XQoder] terminal shell preview requires an interactive TTY.\n');
        return;
    }

    const restoreNoiseGuards = installTerminalNoiseGuards();
    try {
        const settings = resolveSettings(options);
        const runtime = createTerminalAgentRuntime({
            attachBaseUrl: options.attachBaseUrl,
            serverPassword: process.env.XQODER_SERVER_PASSWORD,
            serverUsername: process.env.XQODER_SERVER_USERNAME,
        });
        const restoredSession = await restoreTerminalAgentSession(runtime, settings, {
            continue: options.continue,
            session: options.session,
        });

        // Terminal TUI now runs as an append-only scrollback shell.
        try {
            await runTerminalScrollbackShell(runtime, settings, restoredSession, options, { stdin, stdout, stderr });
        } finally {
            await disposeTerminalAgentRuntime(runtime);
        }
    } finally {
        restoreNoiseGuards();
    }
}
