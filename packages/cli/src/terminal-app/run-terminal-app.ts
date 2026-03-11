import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { getXQoderPaths, ConfigManager, LogLevel, logger, resolveConfigWithEnvOverrides, type MessageAttachment, type SandboxMode } from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/storage-sqlite';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { TerminalEventLoop } from '../terminal-core/event-loop.js';
import { parseInputChunk } from '../terminal-core/input-parser.js';
import { renderTerminalFrame } from '../terminal-core/renderer.js';
import { ProtocolRuntimeBridge, getTranscriptHeight, reduceTerminalRuntimeResize, restoreTerminalHistory } from '../terminal-core/runtime-bridge.js';
import { AnsiPatchWriter } from '../terminal-core/ansi-writer.js';
import { writeToClipboard } from '../terminal-core/clipboard.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import { TuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import { reduceTerminalAppState } from './reducer.js';

export interface TerminalAppOptions {
    dir?: string;
    model?: string;
    agent?: string;
    sandboxMode?: SandboxMode;
    continue?: boolean;
    session?: string;
    prompt?: string;
}

const MAX_TERMINAL_ATTACHMENTS = 5;

function inferAttachmentKind(filePath: string): 'file' | 'image' | 'text' {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        return 'image';
    }
    if (['.md', '.txt', '.json', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.yml', '.yaml'].includes(ext)) {
        return 'text';
    }
    return 'file';
}

function formatAttachmentLabel(filePath: string): string {
    const fileName = path.basename(filePath);
    return fileName.length > 18 ? `${fileName.slice(0, 15)}...` : fileName;
}

function tryHandleEditorCommand(
    prompt: string,
    cwd: string,
    eventLoop: TerminalEventLoop<ReturnType<typeof createInitialTerminalAppState>>,
): boolean {
    const trimmed = prompt.trim();
    if (!trimmed.startsWith('/')) {
        return false;
    }

    const [command, ...rest] = trimmed.split(/\s+/);
    if (command === '/attach') {
        const rawPath = rest.join(' ').trim();
        if (!rawPath) {
            eventLoop.dispatch({ type: 'notice.set', notice: 'Usage: /attach <path>' });
            eventLoop.dispatch({ type: 'editor.reset' });
            return true;
        }

        const resolvedPath = path.resolve(cwd, rawPath);
        if (!fs.existsSync(resolvedPath)) {
            eventLoop.dispatch({ type: 'notice.set', notice: `Attachment missing: ${resolvedPath}` });
            eventLoop.dispatch({ type: 'editor.reset' });
            return true;
        }

        const current = eventLoop.getState().editor.attachments;
        if (current.some((attachment) => attachment.path === resolvedPath)) {
            eventLoop.dispatch({ type: 'notice.set', notice: `Attachment already added: ${path.basename(resolvedPath)}` });
            eventLoop.dispatch({ type: 'editor.reset' });
            return true;
        }

        if (current.length >= MAX_TERMINAL_ATTACHMENTS) {
            eventLoop.dispatch({ type: 'notice.set', notice: `Attachment limit reached (${MAX_TERMINAL_ATTACHMENTS})` });
            eventLoop.dispatch({ type: 'editor.reset' });
            return true;
        }

        eventLoop.dispatch({
            type: 'editor.append-attachment',
            attachment: {
                id: resolvedPath,
                label: formatAttachmentLabel(resolvedPath),
                kind: inferAttachmentKind(resolvedPath),
                path: resolvedPath,
            },
        });
        eventLoop.dispatch({ type: 'notice.set', notice: `Attached ${path.basename(resolvedPath)}` });
        eventLoop.dispatch({ type: 'editor.reset' });
        return true;
    }

    if (command === '/detach') {
        eventLoop.dispatch({ type: 'editor.remove-last-attachment' });
        eventLoop.dispatch({ type: 'notice.set', notice: 'Removed last attachment' });
        eventLoop.dispatch({ type: 'editor.reset' });
        return true;
    }

    if (command === '/attachments' && rest[0] === 'clear') {
        eventLoop.dispatch({ type: 'editor.clear-attachments' });
        eventLoop.dispatch({ type: 'notice.set', notice: 'Cleared attachments' });
        eventLoop.dispatch({ type: 'editor.reset' });
        return true;
    }

    return false;
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

function withRawMode<T>(stdin: NodeJS.ReadStream, run: () => Promise<T>): Promise<T> {
    const originalRawMode = stdin.isRaw;
    try { stdin.setRawMode?.(true); } catch { /* ignore */ }
    return run().finally(() => {
        try { stdin.setRawMode?.(Boolean(originalRawMode)); } catch { /* ignore */ }
    });
}

function enterTerminal(stdout: NodeJS.WriteStream): void {
    stdout.write('\x1b[?1049h');
    stdout.write('\x1b[H\x1b[2J');
    stdout.write('\x1b[?25h\x1b[5 q');
    stdout.write('\x1b[?1003h');
}

function leaveTerminal(stdout: NodeJS.WriteStream): void {
    stdout.write('\x1b[?1003l');
    stdout.write('\x1b[?25h\x1b[0 q\x1b[0m\x1b[?1049l');
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
        stderr.write('[XQoder] terminal-core preview requires an interactive TTY.\n');
        return;
    }

    const restoreNoiseGuards = installTerminalNoiseGuards();
    try {
        const settings = resolveSettings(options);
        const sessionStore = new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
        const agentService = new TuiAgentService(sessionStore);
        const writer = new AnsiPatchWriter(stdout);
        const restoreTarget = options.session ?? (options.continue ? 'latest' : undefined);
        const restoredSessionId = restoreTarget === 'latest'
            ? sessionStore.findLatestSession(settings.dir)?.id
            : restoreTarget;
        const restoredSession = restoredSessionId ? sessionStore.getSession(restoredSessionId) : null;
        const restoredSummary = restoredSessionId ? sessionStore.getSessionSummary(restoredSessionId) : null;
        const eventLoop = new TerminalEventLoop({
        initialState: (() => {
                const initial = reduceTerminalRuntimeResize(createInitialTerminalAppState({
                    width: stdout.columns ?? 120,
                    height: stdout.rows ?? 40,
                }, {
                    cwd: settings.dir,
                    model: settings.model,
                    agent: settings.agent,
                }), {
                    width: stdout.columns ?? 120,
                    height: stdout.rows ?? 40,
                });

                return restoredSession && restoredSummary
                    ? restoreTerminalHistory(initial, {
                        sessionId: restoredSession.id,
                        title: restoredSummary.title,
                        cwd: restoredSummary.cwd,
                        messages: restoredSession.getMessages(),
                    })
                    : initial;
        })(),
        reduce: reduceTerminalAppState,
        render: (state) => ({
            ...renderTerminalFrame(state),
            patches: [],
        }),
        writer,
    });
        const bridge = new ProtocolRuntimeBridge((event) => eventLoop.dispatch(event));

        let activeSessionId: string | undefined = restoredSession?.id;
        let disposed = false;
        let pendingApprovalResolve: ((approved: boolean) => void) | null = null;
        const decoder = new StringDecoder('utf8');

        const submitEditor = async (): Promise<void> => {
            const state = eventLoop.getState();
            const prompt = state.editor.value.trim();
            if (!prompt || state.runtimeStatus === 'thinking' || state.runtimeStatus === 'running-tool' || state.runtimeStatus === 'awaiting-approval') {
                return;
            }

            if (tryHandleEditorCommand(prompt, settings.dir, eventLoop)) {
                await eventLoop.renderNow();
                return;
            }

        const attachments: MessageAttachment[] = state.editor.attachments.map((attachment) => ({
            type: attachment.kind === 'image' ? 'image' : 'file',
            mimeType: attachment.kind === 'image' ? 'image/png' : 'application/octet-stream',
            fileName: attachment.label,
            filePath: attachment.path,
        }));

        eventLoop.dispatch({ type: 'editor.reset' });

        void agentService.sendMessage(prompt, activeSessionId, settings, attachments, {
            onEvent: (event) => {
                bridge.onProtocolEvent(event);
            },
            onToolApproval: async () => new Promise<boolean>((resolve) => {
                pendingApprovalResolve = resolve;
            }),
        }).then((result) => {
            activeSessionId = result.sessionId;
            eventLoop.dispatch({ type: 'session.attached', sessionId: result.sessionId });
            eventLoop.dispatch({ type: 'notice.set', notice: 'Message sent' });
        }).catch((error) => {
            bridge.onProtocolEvent({
                type: 'error',
                sessionId: activeSessionId ?? 'terminal-preview',
                timestamp: Date.now(),
                source: 'runtime',
                message: error instanceof Error ? error.message : String(error),
                recoverable: false,
            });
        });
    };

        const onData = (chunk: string | Buffer): void => {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        if (text === '\u0003') {
            pendingApprovalResolve?.(false);
            pendingApprovalResolve = null;
            disposed = true;
            stdin.off('data', onData);
            void agentService.dispose().finally(() => leaveTerminal(stdout));
            return;
        }

        for (const input of parseInputChunk(text)) {
            const currentState = eventLoop.getState();
            if (currentState.pendingApproval) {
                if (input.type === 'text') {
                    const normalized = input.text.trim().toLowerCase();
                    if (normalized === 'y' || normalized === 'yes') {
                        pendingApprovalResolve?.(true);
                        pendingApprovalResolve = null;
                        continue;
                    }
                    if (normalized === 'n' || normalized === 'no') {
                        pendingApprovalResolve?.(false);
                        pendingApprovalResolve = null;
                        continue;
                    }
                }
                if (input.type === 'key' && input.key === 'escape') {
                    pendingApprovalResolve?.(false);
                    pendingApprovalResolve = null;
                    continue;
                }
            }

            if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
                void submitEditor();
                continue;
            }

            if (input.type === 'key' && input.key === 'c' && input.alt && !input.ctrl) {
                const st = eventLoop.getState();
                const th = getTranscriptHeight(st);
                const first = st.viewport.topLine;
                const last = first + th - 1;
                const block = st.transcriptCodeBlocks.find(
                    (b) => b.startLine <= last && b.endLine >= first,
                );
                if (block && writeToClipboard(block.text)) {
                    eventLoop.dispatch({ type: 'copy.code-block', blockId: block.id });
                    setTimeout(() => {
                        eventLoop.dispatch({ type: 'copy.code-block.clear' });
                    }, 2000);
                }
                continue;
            }

            if (input.type === 'mouse' && input.kind === 'press' && input.button === 'left') {
                const st = eventLoop.getState();
                const transcriptStartRow = 3;
                const scrollbarCol = Math.max(12, st.size.width - 2);
                const copyButtonLeft = scrollbarCol - 12;
                const row = input.y - 1;
                const col = input.x - 1;
                if (row >= transcriptStartRow && col >= copyButtonLeft && col < scrollbarCol) {
                    const lineIndex = st.viewport.topLine + (row - transcriptStartRow);
                    const block = st.transcriptCodeBlocks.find((b) => b.startLine === lineIndex);
                    if (block && writeToClipboard(block.text)) {
                        eventLoop.dispatch({ type: 'copy.code-block', blockId: block.id });
                        setTimeout(() => {
                            eventLoop.dispatch({ type: 'copy.code-block.clear' });
                        }, 2000);
                    }
                }
                continue;
            }

            eventLoop.dispatch({ type: 'input', input });
        }
    };

        const onResize = (): void => {
        eventLoop.dispatch({
            type: 'resize',
            size: {
                width: stdout.columns ?? 120,
                height: stdout.rows ?? 40,
            },
        });
    };

        enterTerminal(stdout);
        try {
            await withRawMode(stdin, async () => {
                stdin.resume();
                stdin.on('data', onData);
                stdout.on('resize', onResize);
                await eventLoop.renderNow();

                if (options.prompt?.trim()) {
                    eventLoop.dispatch({ type: 'editor.set-value', value: options.prompt });
                    await eventLoop.renderNow();
                    void submitEditor();
                }

                while (!disposed) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            });
        } finally {
            try { stdin.off('data', onData); } catch { /* ignore */ }
            try { stdout.off('resize', onResize); } catch { /* ignore */ }
            await agentService.dispose();
            leaveTerminal(stdout);
        }
    } finally {
        restoreNoiseGuards();
    }
}
