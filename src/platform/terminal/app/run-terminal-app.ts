import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { ConfigManager, LogLevel, logger, resolveConfigWithEnvOverrides, type SandboxMode } from '@xqoder/shared';
import type {
    TuiAgentSettings,
    AgentRuntimeEvent,
} from '../../../application/agent/index.js';
import type { ConversationTranscriptEntry } from '../../../domain/conversation/messages.js';
import {
    createTerminalAgentRuntime,
    createTerminalSession,
    disposeTerminalAgentRuntime,
    restoreTerminalAgentSession,
    type TerminalSessionSnapshot,
    type TerminalAgentRuntime,
} from './agent-runtime.js';
import {
    TERMINAL_LOCAL_COMMANDS,
    resolveTerminalLocalCommand,
} from './terminal-local-commands.js';
import {
    TERMINAL_INLINE_EVENT_MAX_LENGTH,
    TERMINAL_INLINE_OUTPUT_MAX_LENGTH,
    appendTerminalAssistantTextDelta,
    completeTerminalAssistantText,
    createTerminalAssistantTextState,
    createTerminalStreamingBlockState,
    createTerminalToolOutputState,
    finishStreamingConversationBlock,
    formatTerminalInlineValue,
    formatTerminalUsageNote,
    formatTerminalStatusNote,
    getTerminalToolKey,
    shouldShowToolArgs,
    splitTerminalOutputBuffer,
    truncateTerminalInlineText,
    writeConversationBlock,
    writeStreamingConversationChunk,
    writeTerminalInlineNote,
} from './terminal-scrollback-output.js';

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

export interface TerminalShellReadline {
    question(query: string): Promise<string>;
    close(): void;
}

export interface TerminalScrollbackShellDependencies {
    createReadlineInterface?: (options: {
        input: NodeJS.ReadStream;
        output: NodeJS.WriteStream;
        terminal: boolean;
    }) => TerminalShellReadline;
    createSession?: typeof createTerminalSession;
    createPermissionsSummary?: (cwd: string) => string;
}

export { TERMINAL_LOCAL_COMMANDS, resolveTerminalLocalCommand };
export type { TerminalLocalCommand } from './terminal-local-commands.js';
export {
    formatTerminalInlineValue,
    splitTerminalOutputBuffer,
    truncateTerminalInlineText,
} from './terminal-scrollback-output.js';

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

export async function runTerminalScrollbackShell(
    runtime: TerminalAgentRuntime,
    settings: TuiAgentSettings,
    restoredSession: TerminalSessionSnapshot | undefined,
    options: TerminalAppOptions,
    streams: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream },
    dependencies: TerminalScrollbackShellDependencies = {},
): Promise<void> {
    const { stdin, stdout } = streams;
    const agentService = runtime.agentService;
    const createReadlineInterface = dependencies.createReadlineInterface ?? readline.createInterface;
    const createSession = dependencies.createSession ?? createTerminalSession;
    const rl = createReadlineInterface({
        input: stdin,
        output: stdout,
        terminal: true,
    });

    let activeSessionId = restoredSession?.sessionId;

    try {
        if (restoredSession?.sessionId) {
            stdout.write(`[resumed ${restoredSession.title ?? restoredSession.sessionId}]\n\n`);
            renderRestoredConversationSignals(stdout, restoredSession.conversationSignals);
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
            const [localCommandToken] = trimmed.split(/\s+/, 1);
            const localCommandArgs = localCommand && localCommandToken
                ? trimmed.slice(localCommandToken.length).trim()
                : '';

            if (localCommand === 'exit') {
                throw new Error('__XQODER_EXIT__');
            }

            if (localCommand === 'new') {
                if (runtime.attachBaseUrl) {
                    const created = await createSession(runtime, settings.dir);
                    activeSessionId = created.id;
                    stdout.write(`[new session ${created.title}]\n\n`);
                } else {
                    activeSessionId = undefined;
                    stdout.write('[new session]\n\n');
                }
                return;
            }

            if (localCommand === 'help') {
                stdout.write('\nAvailable Slash Commands:\n');
                stdout.write('  /help, /?       - Show this help message\n');
                stdout.write('  /exit, /quit    - Exit the application\n');
                stdout.write('  /new, /reset    - Start a new session\n');
                stdout.write('  /clear          - Clear terminal (simulated)\n');
                stdout.write('  /compact        - Compact the active session\n');
                stdout.write('  /memory         - Show project instructions (xqoder.md)\n');
                stdout.write('  /status         - Show current session status\n');
                stdout.write('  /model [name]   - Show or update the active model for this terminal session\n');
                stdout.write('  /plan <goal>    - Route the next turn through the planning workflow prompt\n');
                stdout.write('  /review <scope> - Route the next turn through the review workflow prompt\n');
                stdout.write('  /permissions    - Show effective permission summary for the current project\n\n');
                return;
            }

            if (localCommand === 'memory') {
                stdout.write(`\n[memory] Project instructions loaded from xqoder.md\n`);
                return;
            }

            if (localCommand === 'status') {
                // Routed through the shared TUI service direct-command path below.
            } else if (localCommand === 'clear') {
                stdout.write('\x1Bc');
                return;
            } else if (localCommand === 'model') {
                if (!localCommandArgs) {
                    stdout.write(`\n[model] ${settings.model}\n\n`);
                    return;
                }

                settings.model = localCommandArgs;
                stdout.write(`\n[model] Active model set to ${settings.model}\n\n`);
                return;
            } else if (localCommand === 'plan' || localCommand === 'review') {
                if (!localCommandArgs) {
                    const target = localCommand === 'plan' ? 'goal' : 'scope';
                    stdout.write(`\n[xqoder] Usage: /${localCommand} <${target}>\n\n`);
                    return;
                }
            }

            writeConversationBlock(stdout, 'You', trimmed);

            let assistantReply = '';
            let assistantStreamed = false;
            let assistantDelivered = false;
            let announcedThinking = false;
            let pendingUsageNote: string | null = null;
            const assistantStream = createTerminalStreamingBlockState();
            const assistantText = createTerminalAssistantTextState();
            const toolOutputs = new Map<string, ReturnType<typeof createTerminalToolOutputState>>();

            const flushToolOutput = (
                toolState: ReturnType<typeof createTerminalToolOutputState>,
                flush: boolean,
                force = false,
            ): void => {
                if (toolState.suppressOutput && !force) {
                    return;
                }
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

            const appendToolOutput = (
                toolState: ReturnType<typeof createTerminalToolOutputState>,
                output: string,
            ): void => {
                if (!toolState.suppressOutput) {
                    toolState.buffer += output;
                    return;
                }

                const next = toolState.buffer + output;
                const maxSuppressedErrorPreview = TERMINAL_INLINE_OUTPUT_MAX_LENGTH * 20;
                toolState.buffer = next.length <= maxSuppressedErrorPreview
                    ? next
                    : next.slice(-maxSuppressedErrorPreview);
            };

            const flushPendingOutput = (): void => {
                finishStreamingConversationBlock(stdout, assistantStream);
                for (const toolState of toolOutputs.values()) {
                    flushToolOutput(toolState, true);
                }
            };

            const handleAssistantEvent = (event: AgentRuntimeEvent): void => {
                if (event.type === 'message.delta' && event.payload.role === 'assistant') {
                    const visibleDelta = appendTerminalAssistantTextDelta(assistantText, event.payload.text);
                    assistantReply = assistantText.raw;
                    if (visibleDelta) {
                        assistantStreamed = true;
                        writeStreamingConversationChunk(stdout, 'XQoder', assistantStream, visibleDelta);
                    }
                    return;
                }

                if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
                    const finalDelta = completeTerminalAssistantText(assistantText, event.payload.message.content);
                    assistantReply = assistantText.visible || event.payload.message.content;
                    if (assistantStreamed) {
                        if (finalDelta) {
                            writeStreamingConversationChunk(stdout, 'XQoder', assistantStream, finalDelta);
                        }
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
                    const key = getTerminalToolKey(event.payload);
                    toolOutputs.set(key, createTerminalToolOutputState(event.payload.tool));
                    const argsSummary = shouldShowToolArgs(event.payload.args)
                        ? ` ${formatTerminalInlineValue(event.payload.args, TERMINAL_INLINE_EVENT_MAX_LENGTH)}`
                        : '';
                    writeTerminalInlineNote(stdout, `[tool] ${event.payload.tool}${argsSummary}`);
                    return;
                }

                if (event.type === 'tool.output') {
                    const key = getTerminalToolKey(event.payload);
                    const toolState = toolOutputs.get(key) ?? createTerminalToolOutputState(event.payload.tool);
                    toolOutputs.set(key, toolState);

                    if (event.payload.partial) {
                        toolState.sawPartial = true;
                        appendToolOutput(toolState, event.payload.output);
                        flushToolOutput(toolState, false);
                        return;
                    }

                    if (!toolState.sawPartial) {
                        appendToolOutput(toolState, event.payload.output);
                        flushToolOutput(toolState, true);
                    }
                    return;
                }

                if (event.type === 'tool.completed') {
                    const key = getTerminalToolKey(event.payload);
                    const toolState = toolOutputs.get(key) ?? createTerminalToolOutputState(event.payload.tool);
                    flushToolOutput(toolState, true, !event.payload.success);
                    toolOutputs.delete(key);
                    writeTerminalInlineNote(stdout, `[tool] ${event.payload.tool} ${event.payload.success ? 'done' : 'failed'}`);
                    announcedThinking = false;
                }
            };

            const handleUsageEvent = (event: AgentRuntimeEvent): void => {
                if (event.type !== 'usage') {
                    return;
                }

                pendingUsageNote = formatTerminalUsageNote({
                    model: event.payload.model,
                    promptTokens: event.payload.promptTokens,
                    completionTokens: event.payload.completionTokens,
                    totalTokens: event.payload.totalTokens,
                    ...(event.payload.cost !== undefined ? { cost: event.payload.cost } : {}),
                });
            };

            const sendSettings = { ...settings };
            const result = await agentService.sendMessage(trimmed, activeSessionId, sendSettings, [], {
                onEvent: (event) => {
                    handleAssistantEvent(event);
                    handleToolEvent(event);
                    handleUsageEvent(event);

                    if (event.type === 'status.changed') {
                        const note = formatTerminalStatusNote(event.payload.status, announcedThinking);
                        if (note) {
                            finishStreamingConversationBlock(stdout, assistantStream);
                            writeTerminalInlineNote(stdout, note);
                            if (event.payload.status === 'thinking') {
                                announcedThinking = true;
                            }
                        }
                        return;
                    }

                    if (event.type === 'error') {
                        flushPendingOutput();
                        assistantReply = `Error: ${event.payload.message}`;
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

            if (
                (localCommand === 'status' || localCommand === 'permissions')
                && !activeSessionId
                && result.sessionId.startsWith('direct:')
            ) {
                // Direct commands should not create a synthetic active session in the shell.
            } else {
                activeSessionId = result.sessionId;
            }
            if (!assistantDelivered && assistantStreamed && result.response) {
                const finalDelta = completeTerminalAssistantText(assistantText, result.response);
                assistantReply = assistantText.visible || result.response;
                if (finalDelta) {
                    writeStreamingConversationChunk(stdout, 'XQoder', assistantStream, finalDelta);
                }
            }
            flushPendingOutput();
            if (!assistantDelivered) {
                assistantReply = result.response ?? assistantReply;
                if (!assistantStreamed) {
                    writeConversationBlock(stdout, 'XQoder', assistantReply || '(No response)');
                }
            }
            if (pendingUsageNote) {
                writeTerminalInlineNote(stdout, pendingUsageNote);
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

function renderRestoredConversationSignals(
    stdout: NodeJS.WriteStream,
    conversationSignals: ConversationTranscriptEntry[] | undefined,
): void {
    const recentSignals = (conversationSignals ?? [])
        .slice(-4)
        .map(formatResumeConversationSignal)
        .filter((line): line is string => Boolean(line));

    if (recentSignals.length === 0) {
        return;
    }

    writeTerminalInlineNote(stdout, '[resume] Recent conversation signals:');
    for (const line of recentSignals) {
        writeTerminalInlineNote(stdout, line);
    }
    stdout.write('\n');
}

function formatResumeConversationSignal(
    signal: ConversationTranscriptEntry,
): string | undefined {
    const content = truncateTerminalInlineText(
        String(signal.content ?? '').replace(/\s+/g, ' ').trim(),
        TERMINAL_INLINE_OUTPUT_MAX_LENGTH,
    );
    if (!content) {
        return undefined;
    }

    if (signal.type === 'tool') {
        return `[resume:tool${signal.toolName ? `:${signal.toolName}` : ''}] ${content}`;
    }

    if (signal.type === 'verification') {
        const status = signal.blocked === true
            ? 'verification:block'
            : signal.ok === false
                ? 'verification:fail'
                : 'verification:ok';
        return `[resume:${status}] ${content}`;
    }

    return `[resume:${signal.type}] ${content}`;
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
