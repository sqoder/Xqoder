import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { getXQoderPaths, ConfigManager, LogLevel, logger, resolveConfigWithEnvOverrides, getDefaultModelForProvider, getKnownModelsForProvider, SUPPORTED_LLM_PROVIDERS, loadCustomCommands, executeCustomCommand, loadTuiConfig, writeTuiConfig, type MessageAttachment, type SandboxMode, type LLMProviderName } from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/storage-sqlite';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { TerminalEventLoop } from '../terminal-core/event-loop.js';
import { parseInputChunkWithRest } from '../terminal-core/input-parser.js';
import { computeLayout, renderTerminalFrame } from '../terminal-core/renderer.js';
import { getTheme, TERMINAL_THEME_IDS, TERMINAL_THEME_LABELS } from '../terminal-core/renderer-boxes.js';
import { getEditorViewModel, characterIndexAtDisplayColumn, expandEditorValueForSubmit } from '../terminal-core/editor-model.js';
import { buildScrollbarModel, buildViewportSelectedText, resolveViewportTopLineFromScrollbar } from '../terminal-core/viewport-model.js';
import { ProtocolRuntimeBridge, getTranscriptHeight, reduceTerminalRuntimeResize, restoreTerminalHistory } from '../terminal-core/runtime-bridge.js';
import { AnsiPatchWriter } from '../terminal-core/ansi-writer.js';
import { getQuestionFallbackSelection, resolveApprovalInputAction, resolveQuestionInputAction } from '../terminal-core/interaction-protocol.js';
import { getClipboardService, readFromClipboard, writeToClipboardOSC52 } from '../terminal-core/clipboard.js';
import { copyTarget, getCopyTargetAtLine, getFirstVisibleCodeBlockTarget } from '../terminal-core/copy-action.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import { TuiAgentService, RemoteTuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import { reduceTerminalAppState } from './reducer.js';
import { resolveCtrlCAction } from './interrupt-policy.js';

export interface TerminalAppOptions {
    dir?: string;
    model?: string;
    agent?: string;
    sandboxMode?: SandboxMode;
    continue?: boolean;
    session?: string;
    prompt?: string;
    /** 连接远程 serve（attach 模式），TUI 通过 HTTP 发消息 */
    attachBaseUrl?: string;
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

function loadFilepickerEntries(dir: string): Array<{ path: string; label: string; isDir: boolean }> {
    const entries: Array<{ path: string; label: string; isDir: boolean }> = [];
    const resolvedDir = path.resolve(dir);
    const parent = path.dirname(resolvedDir);
    if (parent !== resolvedDir) {
        entries.push({ path: parent, label: '..', isDir: true });
    }
    try {
        const items = fs.readdirSync(resolvedDir, { withFileTypes: true });
        const list = items
            .filter((item) => {
                if (item.name.startsWith('.')) return false;
                if (item.name === 'node_modules' || item.name === 'dist') return false;
                return true;
            })
            .map((item) => ({
                path: path.join(resolvedDir, item.name),
                label: item.name + (item.isDirectory() ? '/' : ''),
                isDir: item.isDirectory(),
            }))
            .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.label.localeCompare(b.label)));
        entries.push(...list);
    } catch {
        // leave only ..
    }
    return entries;
}

const INIT_FLAG_FILE = 'init';

function hasInitFlag(projectDir: string): boolean {
    const flagPath = path.join(projectDir, '.xqoder', INIT_FLAG_FILE);
    return fs.existsSync(flagPath);
}

function markProjectInitialized(projectDir: string): void {
    const dotXqoder = path.join(projectDir, '.xqoder');
    const flagPath = path.join(dotXqoder, INIT_FLAG_FILE);
    if (!fs.existsSync(dotXqoder)) {
        fs.mkdirSync(dotXqoder, { recursive: true });
    }
    fs.writeFileSync(flagPath, '', 'utf-8');
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
    stdout.write('\x1b[?2004h');
    // SGR 鼠标：滚轮与点击可被解析为 \x1b[<code;x;yM，用于对话区上下滚动查看历史
    stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
}

function leaveTerminal(stdout: NodeJS.WriteStream): void {
    stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
    stdout.write('\x1b[?2004l');
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
        const attachBaseUrl = options.attachBaseUrl?.replace(/\/$/, '');
        const sessionStore = attachBaseUrl ? null : new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
        const agentService = attachBaseUrl
            ? new RemoteTuiAgentService(attachBaseUrl, process.env.XQODER_SERVER_PASSWORD
                ? { username: process.env.XQODER_SERVER_USERNAME ?? 'xqoder', password: process.env.XQODER_SERVER_PASSWORD }
                : undefined)
            : new TuiAgentService(sessionStore!);
        const writer = new AnsiPatchWriter(stdout);
        let restoredSessionId: string | undefined;
        let restoredSession: import('@xqoder/agent').AgentSession | null = null;
        let restoredSummary: import('@xqoder/agent').PersistedSessionSummary | null = null;
        if (attachBaseUrl) {
            const remote = agentService as RemoteTuiAgentService;
            const list = await remote.listSessions(settings.dir, 1);
            restoredSessionId = list[0]?.id;
        } else {
            const restoreTarget = options.session ?? (options.continue ? 'latest' : undefined);
            restoredSessionId = restoreTarget === 'latest'
                ? sessionStore!.findLatestSession(settings.dir)?.id
                : restoreTarget;
            restoredSession = restoredSessionId ? sessionStore!.getSession(restoredSessionId) ?? null : null;
            restoredSummary = restoredSessionId ? sessionStore!.getSessionSummary(restoredSessionId) : null;
        }
        const eventLoop = new TerminalEventLoop({
        initialState: (() => {
                const tui = loadTuiConfig();
                const themeId = tui.theme && TERMINAL_THEME_IDS.includes(tui.theme as typeof TERMINAL_THEME_IDS[number]) ? tui.theme : 'default';
                const initial = reduceTerminalRuntimeResize(createInitialTerminalAppState({
                    width: stdout.columns ?? 120,
                    height: stdout.rows ?? 40,
                }, {
                    cwd: settings.dir,
                    model: settings.model,
                    agent: settings.agent,
                    themeId,
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
            ...renderTerminalFrame(state, getTheme(state.themeId)),
            patches: [],
        }),
        writer,
    });
        const bridge = new ProtocolRuntimeBridge((event) => eventLoop.dispatch(event));

        let activeSessionId: string | undefined = restoredSession?.id;
        let disposed = false;
        let quitConfirmPending = false;
        let quitConfirmTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingApprovalResolve: ((approved: boolean) => void) | null = null;
        let pendingQuestionResolve: ((answer: { requestId: string; selected: string[]; customText?: string }) => void) | null = null;
        /** 当前 session 内是否已选择「Always allow in this session」 */
        let autoApproveToolsForSession = false;
        let enterSubmitTimer: ReturnType<typeof setTimeout> | null = null;
        let pasteHintClearTimer: ReturnType<typeof setTimeout> | null = null;
        let bracketedPasteBuffer: string | null = null;
        let inputBuffer = '';
        let selectionAnchor: { line: number; column: number } | null = null;
        /** 拖动右侧导航条时，拇指相对指针的偏移（行），用于快速定位上下文 */
        let scrollbarDragOffset: number | null = null;
        const decoder = new StringDecoder('utf8');
        /** 仅多行且字数不少时显示黄色 [Pasted N lines]；单行或过短时直接显示原文 */
        const MIN_PASTE_HINT_LENGTH = 50;
        const showPasteHint = (content: string): void => {
            const lineCount = Math.max(1, content.split('\n').length);
            if (lineCount < 2 || content.length < MIN_PASTE_HINT_LENGTH) return;
            if (pasteHintClearTimer) clearTimeout(pasteHintClearTimer);
            eventLoop.dispatch({ type: 'paste.hint.show', lineCount });
            pasteHintClearTimer = setTimeout(() => {
                eventLoop.dispatch({ type: 'paste.hint.clear' });
                pasteHintClearTimer = null;
            }, 2500);
        };
        const ENTER_SUBMIT_DELAY_MS = 120;
        const BRACKETED_PASTE_START = '\x1b[200~';
        const BRACKETED_PASTE_END = '\x1b[201~';

        const submitEditor = async (): Promise<void> => {
            const state = eventLoop.getState();
            const prompt = expandEditorValueForSubmit(state.editor).trim();
            if (!prompt || state.runtimeStatus === 'thinking' || state.runtimeStatus === 'running-tool' || state.pendingApproval || state.pendingQuestion) {
                return;
            }

            if (tryHandleEditorCommand(prompt, settings.dir, eventLoop)) {
                await eventLoop.renderNow();
                return;
            }

            // attach 模式：/session list | new | switch <id>（先清空输入并渲染，再异步执行，避免卡住）
            if (attachBaseUrl && (prompt === '/session' || prompt.startsWith('/session '))) {
                const remote = agentService as RemoteTuiAgentService;
                const parts = prompt.split(/\s+/);
                const sub = parts[1];
                eventLoop.dispatch({ type: 'editor.reset' });
                await eventLoop.renderNow();
                void (async () => {
                    try {
                        if (sub === 'list') {
                            const list = await remote.listSessions(settings.dir, 20);
                            const notice =
                                list.length === 0
                                    ? 'No sessions. Use /session new to create one.'
                                    : `Sessions (${list.length}): ${list.slice(0, 5).map((s) => s.id).join(', ')}${list.length > 5 ? '…' : ''} — /session switch <id>`;
                            eventLoop.dispatch({ type: 'notice.set', notice });
                        } else if (sub === 'new') {
                            const created = await remote.createSession(settings.dir);
                            activeSessionId = created.id;
                            eventLoop.dispatch({
                                type: 'session.restored',
                                sessionId: created.id,
                                title: created.title,
                                messages: [],
                            });
                            eventLoop.dispatch({ type: 'notice.set', notice: `New session: ${created.id}` });
                        } else if (sub === 'switch' && parts[2]) {
                            const id = parts[2].trim();
                            const data = await remote.getSessionMessages(id);
                            activeSessionId = id;
                            eventLoop.dispatch({
                                type: 'session.restored',
                                sessionId: id,
                                messages: data.messages,
                            });
                        } else {
                            eventLoop.dispatch({
                                type: 'notice.set',
                                notice: 'Usage: /session list | new | switch <id>',
                            });
                        }
                    } catch (err) {
                        eventLoop.dispatch({
                            type: 'notice.set',
                            notice: err instanceof Error ? err.message : String(err),
                        });
                    }
                    await eventLoop.renderNow();
                })();
                return;
            }

        const attachments: MessageAttachment[] = state.editor.attachments.map((attachment) => ({
            type: attachment.kind === 'image' ? 'image' : 'file',
            mimeType: attachment.kind === 'image' ? 'image/png' : 'application/octet-stream',
            fileName: attachment.label,
            filePath: attachment.path,
        }));

        eventLoop.dispatch({ type: 'editor.reset' });

        const sendSettings = { ...settings, model: state.model ?? settings.model };
        void agentService.sendMessage(prompt, activeSessionId, sendSettings, attachments, {
            onEvent: (event) => {
                bridge.onProtocolEvent(event);
            },
            onToolApproval: async () => {
                if (autoApproveToolsForSession) {
                    return true;
                }
                return new Promise<boolean>((resolve) => {
                    pendingApprovalResolve = resolve;
                });
            },
            onQuestion: async (_request) => {
                return new Promise<{ requestId: string; selected: string[]; customText?: string }>((resolve) => {
                    pendingQuestionResolve = resolve;
                });
            },
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

        const INIT_PROMPT = `Please analyze this codebase and create (or update) an XQoder.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 20 lines long.
If there's already an XQoder.md, improve it.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.`;

        const submitInitPrompt = (): void => {
            if (eventLoop.getState().runtimeStatus !== 'idle' && eventLoop.getState().runtimeStatus !== 'done' && eventLoop.getState().runtimeStatus !== 'error') {
                return;
            }
            const sendSettings = { ...settings, model: eventLoop.getState().model ?? settings.model };
            void agentService.sendMessage(INIT_PROMPT, activeSessionId, sendSettings, [], {
                onEvent: (event) => { bridge.onProtocolEvent(event); },
                onToolApproval: async () => {
                    if (autoApproveToolsForSession) {
                        return true;
                    }
                    return new Promise<boolean>((resolve) => { pendingApprovalResolve = resolve; });
                },
                onQuestion: async (_request) => {
                    return new Promise<{ requestId: string; selected: string[]; customText?: string }>((resolve) => {
                        pendingQuestionResolve = resolve;
                    });
                },
            }).then((result) => {
                activeSessionId = result.sessionId;
                eventLoop.dispatch({ type: 'session.attached', sessionId: result.sessionId });
                eventLoop.dispatch({ type: 'notice.set', notice: 'Init sent — creating XQoder.md' });
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
        let text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        if (text === '\u0003') {
            const stateOnInterrupt = eventLoop.getState();
            const ctrlCAction = resolveCtrlCAction(stateOnInterrupt, quitConfirmPending);

            if (ctrlCAction === 'cancel-request') {
                pendingApprovalResolve?.(false);
                pendingApprovalResolve = null;
                const pendingQuestion = stateOnInterrupt.pendingQuestion;
                if (pendingQuestion) {
                    pendingQuestionResolve?.({
                        requestId: pendingQuestion.requestId,
                        selected: getQuestionFallbackSelection(pendingQuestion),
                    });
                    pendingQuestionResolve = null;
                }
                if ('cancel' in agentService && typeof agentService.cancel === 'function') {
                    agentService.cancel();
                }
                eventLoop.dispatch({ type: 'notice.set', notice: 'Cancelled current request' });
                void eventLoop.renderNow();
                return;
            }

            pendingApprovalResolve?.(false);
            pendingApprovalResolve = null;
            const pendingQuestion = eventLoop.getState().pendingQuestion;
            if (pendingQuestion) {
                pendingQuestionResolve?.({
                    requestId: pendingQuestion.requestId,
                    selected: getQuestionFallbackSelection(pendingQuestion),
                });
                pendingQuestionResolve = null;
            }
            if (ctrlCAction === 'confirm-quit') {
                if (quitConfirmTimer) {
                    clearTimeout(quitConfirmTimer);
                    quitConfirmTimer = null;
                }
                quitConfirmPending = false;
                disposed = true;
                stdin.off('data', onData);
                void agentService.dispose().finally(() => leaveTerminal(stdout));
                return;
            }

            quitConfirmPending = true;
            eventLoop.dispatch({ type: 'notice.set', notice: 'Press Ctrl+C again to quit' });
            eventLoop.renderNow();
            if (quitConfirmTimer) clearTimeout(quitConfirmTimer);
            quitConfirmTimer = setTimeout(() => {
                quitConfirmTimer = null;
                quitConfirmPending = false;
                eventLoop.dispatch({ type: 'notice.set', notice: undefined });
                eventLoop.renderNow();
            }, 2500);
            return;
        }

        if (text === '\x16' || text === '\x1bv') {
            const content = readFromClipboard();
            if (content) {
                const normalized = content.replace(/\r\n?/g, '\n');
                eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: normalized, raw: '' } });
                if (!normalized.includes('\n')) showPasteHint(normalized);
            }
            return;
        }

        if (bracketedPasteBuffer !== null) {
            bracketedPasteBuffer += text;
            const endIdx = bracketedPasteBuffer.indexOf(BRACKETED_PASTE_END);
            if (endIdx === -1) return;
            const content = bracketedPasteBuffer.slice(0, endIdx).replace(/\r\n?/g, '\n');
            text = bracketedPasteBuffer.slice(endIdx + BRACKETED_PASTE_END.length);
            bracketedPasteBuffer = null;
            eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: content, raw: '' } });
            if (!content.includes('\n')) showPasteHint(content);
            if (text.length === 0) return;
        }

        if (bracketedPasteBuffer === null && text.startsWith(BRACKETED_PASTE_START)) {
            const endIdx = text.indexOf(BRACKETED_PASTE_END, BRACKETED_PASTE_START.length);
            if (endIdx === -1) {
                bracketedPasteBuffer = text.slice(BRACKETED_PASTE_START.length);
                return;
            }
            const content = text.slice(BRACKETED_PASTE_START.length, endIdx).replace(/\r\n?/g, '\n');
            eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: content, raw: '' } });
            if (!content.includes('\n')) showPasteHint(content);
            text = text.slice(endIdx + BRACKETED_PASTE_END.length);
            if (text.length === 0) return;
        }

        let sawFollowUpAfterEnter = false;
        if (enterSubmitTimer != null) {
            clearTimeout(enterSubmitTimer);
            enterSubmitTimer = null;
            eventLoop.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
            sawFollowUpAfterEnter = true;
        }

        const hasNewline = text.includes('\n') || text.includes('\r');
        const hasNonNewline = text.replace(/\r\n?|\n/g, '').length > 0;
        if (hasNewline && hasNonNewline && !text.startsWith(BRACKETED_PASTE_START)) {
            const normalized = text.replace(/\r\n?/g, '\n');
            eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: normalized, raw: text } });
            if (!normalized.includes('\n')) showPasteHint(normalized);
            return;
        }

        inputBuffer += text;
        const { events, rest } = parseInputChunkWithRest(inputBuffer);
        inputBuffer = rest;

        for (const input of events) {
            const currentState = eventLoop.getState();
            if (currentState.pendingApproval) {
                const action = resolveApprovalInputAction(input, currentState.pendingApproval.selectedIndex ?? 0);
                if (action.type === 'move') {
                    eventLoop.dispatch({ type: 'approval.menu.move', selectedIndex: action.selectedIndex });
                    continue;
                }
                if (action.type === 'resolve') {
                    if (action.alwaysAllowSession) {
                        autoApproveToolsForSession = true;
                    }
                    pendingApprovalResolve?.(action.approved);
                    pendingApprovalResolve = null;
                    continue;
                }
            }

            if (currentState.pendingQuestion) {
                const question = currentState.pendingQuestion;
                const action = resolveQuestionInputAction(input, question);
                if (action.type === 'move') {
                    eventLoop.dispatch({ type: 'question.menu.move', selectedIndex: action.selectedIndex });
                    continue;
                }
                if (action.type === 'toggle') {
                    eventLoop.dispatch({ type: 'question.toggle-option', optionLabel: action.optionLabel });
                    continue;
                }
                if (action.type === 'append-custom') {
                    eventLoop.dispatch({ type: 'question.custom.append', text: action.text });
                    continue;
                }
                if (action.type === 'backspace-custom') {
                    eventLoop.dispatch({ type: 'question.custom.backspace' });
                    continue;
                }
                if (action.type === 'submit') {
                    pendingQuestionResolve?.({
                        requestId: question.requestId,
                        selected: action.selected ?? getQuestionFallbackSelection(question),
                        ...(action.customText ? { customText: action.customText } : {}),
                    });
                    pendingQuestionResolve = null;
                    continue;
                }
                if (action.type === 'cancel') {
                    pendingQuestionResolve?.({
                        requestId: question.requestId,
                        selected: getQuestionFallbackSelection(question),
                    });
                    pendingQuestionResolve = null;
                    continue;
                }
            }

            const st = eventLoop.getState();
            if (st.overlay) {
                if (input.type === 'text' && (input.text === 'j' || input.text === 'k') && st.overlay.type !== 'arguments') {
                    eventLoop.dispatch({ type: 'overlay.move', delta: input.text === 'j' ? 1 : -1 });
                    continue;
                }
                if (input.type === 'text' && input.text === 'l' && (st.overlay.type === 'filepicker' || st.overlay.type === 'complete')) {
                    const ov = st.overlay;
                    const sel = ov.items[ov.selectedIndex] as { path: string; isDir: boolean } | undefined;
                    if (sel?.isDir) {
                        if (ov.type === 'filepicker') {
                            const nextItems = loadFilepickerEntries(sel.path);
                            eventLoop.dispatch({ type: 'overlay.filepickerNavigate', currentDir: sel.path, items: nextItems });
                        } else {
                            if (ov.expandedDirs.includes(sel.path)) {
                                eventLoop.dispatch({ type: 'overlay.completeCollapse', path: sel.path });
                            } else {
                                const children = loadFilepickerEntries(sel.path);
                                eventLoop.dispatch({ type: 'overlay.completeExpand', path: sel.path, children });
                            }
                        }
                        continue;
                    }
                }
                if (st.overlay.type === 'arguments') {
                    if (input.type === 'text') {
                        eventLoop.dispatch({ type: 'overlay.argumentsEdit', append: input.text });
                        continue;
                    }
                    if (input.type === 'key' && input.key === 'backspace') {
                        eventLoop.dispatch({ type: 'overlay.argumentsEdit', backspace: true });
                        continue;
                    }
                }
                if (st.overlay.type === 'model' && ((input.type === 'key' && (input.key === 'left' || input.key === 'right')) || (input.type === 'text' && (input.text === 'h' || input.text === 'l')))) {
                    const ov = st.overlay;
                    const len = ov.providers.length;
                    const goRight = input.type === 'key' ? input.key === 'right' : input.text === 'l';
                    const next = goRight ? (ov.providerIndex + 1) % len : (ov.providerIndex - 1 + len) % len;
                    const items = getKnownModelsForProvider(ov.providers[next]! as LLMProviderName).map((id) => ({ id, label: id }));
                    eventLoop.dispatch({ type: 'overlay.modelSetProvider', providerIndex: next, items });
                    continue;
                }
                if (input.type === 'key') {
                    if (input.key === 'up') {
                        eventLoop.dispatch({ type: 'overlay.move', delta: -1 });
                        continue;
                    }
                    if (input.key === 'down') {
                        eventLoop.dispatch({ type: 'overlay.move', delta: 1 });
                        continue;
                    }
                    if (input.key === 'escape') {
                        if (st.overlay.type === 'complete') {
                            eventLoop.dispatch({ type: 'overlay.close' });
                            eventLoop.dispatch({ type: 'input', input: { type: 'text', text: '@', raw: '@' } });
                        } else if (st.overlay.type === 'init') {
                            markProjectInitialized(settings.dir);
                            eventLoop.dispatch({ type: 'overlay.close' });
                        } else {
                            eventLoop.dispatch({ type: 'overlay.close' });
                        }
                        continue;
                    }
                    if (input.key === 'backspace' && (st.overlay?.type === 'filepicker' || st.overlay?.type === 'complete')) {
                        const ov = st.overlay;
                        if (ov.type === 'complete') {
                            const sel = ov.items[ov.selectedIndex] as { path: string; isDir: boolean } | undefined;
                            if (sel?.isDir && ov.expandedDirs.includes(sel.path)) {
                                eventLoop.dispatch({ type: 'overlay.completeCollapse', path: sel.path });
                            }
                        } else {
                            const parent = path.dirname(ov.currentDir);
                            if (parent !== ov.currentDir) {
                                const nextItems = loadFilepickerEntries(parent);
                                eventLoop.dispatch({ type: 'overlay.filepickerNavigate', currentDir: parent, items: nextItems });
                            }
                        }
                        continue;
                    }
                    if (input.key === 'enter' && !input.ctrl && !input.alt) {
                        const ov = st.overlay;
                        if (ov.type === 'arguments') {
                            const newValues = { ...ov.values, [ov.variables[ov.selectedIndex]!]: ov.editBuffer };
                            if (ov.selectedIndex < ov.variables.length - 1) {
                                eventLoop.dispatch({ type: 'overlay.argumentsAdvance', values: newValues });
                            } else {
                                eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'arguments', commandName: ov.commandName, values: newValues });
                                const custom = loadCustomCommands(settings.dir).find((c) => c.name === ov.commandName);
                                if (custom) {
                                    try {
                                        const out = executeCustomCommand(custom, newValues);
                                        eventLoop.dispatch({ type: 'notice.set', notice: out ? out.slice(0, 80) + (out.length > 80 ? '…' : '') : 'Done' });
                                    } catch (err) {
                                        eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                                    }
                                }
                            }
                            continue;
                        }
                        const item = ov.type !== 'init' && 'items' in ov ? ov.items[ov.selectedIndex] : undefined;
                        if (ov.type === 'session' && item) {
                            const sItem = item as { id: string; title: string };
                            eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'session', id: sItem.id, title: sItem.title });
                            eventLoop.renderNow();
                            void (async () => {
                                try {
                                    if (attachBaseUrl) {
                                        const remote = agentService as RemoteTuiAgentService;
                                        const data = await remote.getSessionMessages(sItem.id);
                                        activeSessionId = sItem.id;
                                        eventLoop.dispatch({
                                            type: 'session.restored',
                                            sessionId: sItem.id,
                                            messages: data.messages,
                                        });
                                        eventLoop.dispatch({ type: 'notice.set', notice: `Session: ${sItem.title}` });
                                    } else {
                                        const sess = sessionStore!.getSession(sItem.id);
                                        const summary = sessionStore!.getSessionSummary(sItem.id);
                                        if (sess && summary) {
                                            activeSessionId = sItem.id;
                                            eventLoop.dispatch({
                                                type: 'session.restored',
                                                sessionId: sItem.id,
                                                title: summary.title,
                                                cwd: summary.cwd,
                                                messages: sess.getMessages(),
                                            });
                                            eventLoop.dispatch({ type: 'notice.set', notice: `Session: ${summary.title}` });
                                        }
                                    }
                                } catch (err) {
                                    eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                                }
                                await eventLoop.renderNow();
                            })();
                        } else if (ov.type === 'model' && item) {
                            const mItem = item as { id: string };
                            eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'model', id: mItem.id });
                            eventLoop.dispatch({ type: 'model.set', model: mItem.id });
                            eventLoop.dispatch({ type: 'notice.set', notice: `Model: ${mItem.id}` });
                        } else if (ov.type === 'theme' && item) {
                            const tItem = item as { id: string };
                            eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'theme', id: tItem.id });
                            try { writeTuiConfig({ theme: tItem.id }); } catch { /* ignore */ }
                            eventLoop.dispatch({ type: 'notice.set', notice: `Theme: ${tItem.id}` });
                        } else if (ov.type === 'init') {
                            const initItem = ov.items[ov.selectedIndex];
                            eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'init' });
                            markProjectInitialized(settings.dir);
                            if (initItem?.id === 'init') { submitInitPrompt(); }
                        } else if (ov.type === 'commands' && item) {
                            const cmdId = (item as { id: string; label: string }).id;
                            eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'commands', id: cmdId });
                            runCommandFromPalette(cmdId);
                        } else if (ov.type === 'filepicker' && item) {
                            const fpItem = item as { path: string; label: string; isDir: boolean };
                            if (fpItem.isDir) {
                                const nextItems = loadFilepickerEntries(fpItem.path);
                                eventLoop.dispatch({ type: 'overlay.filepickerNavigate', currentDir: fpItem.path, items: nextItems });
                            } else {
                                eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'filepicker', path: fpItem.path });
                                const state = eventLoop.getState();
                                if (state.editor.attachments.length >= MAX_TERMINAL_ATTACHMENTS) {
                                    eventLoop.dispatch({ type: 'notice.set', notice: `Attachment limit (${MAX_TERMINAL_ATTACHMENTS})` });
                                } else {
                                    eventLoop.dispatch({
                                        type: 'editor.append-attachment',
                                        attachment: {
                                            id: fpItem.path,
                                            label: formatAttachmentLabel(fpItem.path),
                                            kind: inferAttachmentKind(fpItem.path),
                                            path: fpItem.path,
                                        },
                                    });
                                    eventLoop.dispatch({ type: 'notice.set', notice: `Attached ${path.basename(fpItem.path)}` });
                                }
                            }
                        } else if (ov.type === 'complete' && item) {
                            const fpItem = item as { path: string; label: string; isDir: boolean };
                            if (fpItem.isDir) {
                                if (ov.expandedDirs.includes(fpItem.path)) {
                                    eventLoop.dispatch({ type: 'overlay.completeCollapse', path: fpItem.path });
                                } else {
                                    const children = loadFilepickerEntries(fpItem.path);
                                    eventLoop.dispatch({ type: 'overlay.completeExpand', path: fpItem.path, children });
                                }
                            } else {
                                eventLoop.dispatch({ type: 'overlay.closeWithSelect', kind: 'complete', path: fpItem.path });
                                eventLoop.dispatch({ type: 'input', input: { type: 'text', text: fpItem.path, raw: fpItem.path } });
                            }
                        }
                        continue;
                    }
                }
                continue;
            }

            function runCommandFromPalette(id: string): void {
                if (id === 'help') {
                    eventLoop.dispatch({ type: 'notice.set', notice: 'Ctrl+S Session  Ctrl+O Model  Ctrl+N New  Ctrl+F File  Ctrl+K Commands  Ctrl+? Help  ↑↓ Enter Esc in overlay' });
                    return;
                }
                if (id === 'session') {
                    eventLoop.renderNow();
                    void (async () => {
                        try {
                            let items: Array<{ id: string; title: string }>;
                            if (attachBaseUrl) {
                                const remote = agentService as RemoteTuiAgentService;
                                const list = await remote.listSessions(settings.dir, 20);
                                items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                            } else {
                                const list = sessionStore!.listSessions(settings.dir, 20);
                                items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                            }
                            eventLoop.dispatch({ type: 'overlay.open', kind: 'session', items });
                        } catch (err) {
                            eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                        }
                        await eventLoop.renderNow();
                    })();
                    return;
                }
                if (id === 'newSession') {
                    eventLoop.dispatch({ type: 'editor.reset' });
                    if (attachBaseUrl) {
                        const remote = agentService as RemoteTuiAgentService;
                        void (async () => {
                            try {
                                const created = await remote.createSession(settings.dir);
                                activeSessionId = created.id;
                                eventLoop.dispatch({ type: 'session.restored', sessionId: created.id, title: created.title, messages: [] });
                                eventLoop.dispatch({ type: 'notice.set', notice: `New session: ${created.title}` });
                            } catch (err) {
                                eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                            }
                            await eventLoop.renderNow();
                        })();
                    } else {
                        activeSessionId = undefined;
                        eventLoop.dispatch({ type: 'session.new' });
                    }
                    return;
                }
                if (id === 'model') {
                    const loadedConfig = new ConfigManager().load({ cwd: settings.dir });
                    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
                    const current = eventLoop.getState().model ?? settings.model ?? config.llm.model;
                    const providers = [...SUPPORTED_LLM_PROVIDERS];
                    let providerIndex = providers.findIndex((p) => getDefaultModelForProvider(p) === current || getKnownModelsForProvider(p).includes(current));
                    if (providerIndex < 0) providerIndex = 0;
                    const items = getKnownModelsForProvider(providers[providerIndex]! as LLMProviderName).map((id) => ({ id, label: id }));
                    eventLoop.dispatch({ type: 'overlay.open', kind: 'model', providers, providerIndex, items });
                    return;
                }
                if (id === 'filepicker') {
                    const cwd = eventLoop.getState().cwd ?? settings.dir;
                    const items = loadFilepickerEntries(cwd);
                    eventLoop.dispatch({ type: 'overlay.open', kind: 'filepicker', currentDir: cwd, items });
                    return;
                }
                if (id === 'quit') {
                    disposed = true;
                    stdin.off('data', onData);
                    void agentService.dispose().finally(() => leaveTerminal(stdout));
                    return;
                }
                const custom = loadCustomCommands(settings.dir).find((c) => c.name === id);
                if (custom) {
                    if (custom.variables.length > 0) {
                        eventLoop.dispatch({ type: 'overlay.open', kind: 'arguments', commandName: custom.name, variables: custom.variables });
                    } else {
                        try {
                            const out = executeCustomCommand(custom, {});
                            eventLoop.dispatch({ type: 'notice.set', notice: out ? out.slice(0, 80) + (out.length > 80 ? '…' : '') : 'Done' });
                        } catch (err) {
                            eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                        }
                    }
                }
            }

            if (input.type === 'key' && input.key === 'f' && input.ctrl && !input.alt) {
                const cwd = st.cwd ?? settings.dir;
                const items = loadFilepickerEntries(cwd);
                eventLoop.dispatch({ type: 'overlay.open', kind: 'filepicker', currentDir: cwd, items });
                continue;
            }
            if (input.type === 'key' && input.key === 'k' && input.ctrl && !input.alt) {
                const builtIn: Array<{ id: string; label: string }> = [
                    { id: 'help', label: 'Show Help' },
                    { id: 'session', label: 'Switch Session' },
                    { id: 'newSession', label: 'New Session' },
                    { id: 'model', label: 'Select Model' },
                    { id: 'filepicker', label: 'Pick File' },
                    { id: 'quit', label: 'Quit' },
                ];
                const custom = loadCustomCommands(settings.dir).map((c) => ({ id: c.name, label: c.name }));
                eventLoop.dispatch({ type: 'overlay.open', kind: 'commands', items: [...builtIn, ...custom] });
                continue;
            }
            if (input.type === 'key' && input.key === 't' && input.ctrl && !input.alt) {
                eventLoop.dispatch({
                    type: 'overlay.open',
                    kind: 'theme',
                    items: TERMINAL_THEME_IDS.map((id) => ({ id, label: TERMINAL_THEME_LABELS[id] ?? id })),
                });
                continue;
            }
            if (input.type === 'key' && input.key === 's' && input.ctrl && !input.alt) {
                eventLoop.dispatch({ type: 'editor.reset' });
                eventLoop.renderNow();
                void (async () => {
                    try {
                        let items: Array<{ id: string; title: string }>;
                        if (attachBaseUrl) {
                            const remote = agentService as RemoteTuiAgentService;
                            const list = await remote.listSessions(settings.dir, 20);
                            items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                        } else {
                            const list = sessionStore!.listSessions(settings.dir, 20);
                            items = list.map((s) => ({ id: s.id, title: s.title || s.id }));
                        }
                        eventLoop.dispatch({ type: 'overlay.open', kind: 'session', items });
                    } catch (err) {
                        eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                    }
                    await eventLoop.renderNow();
                })();
                continue;
            }
            if (input.type === 'key' && (input.key === '?' || input.key === 'h') && input.ctrl && !input.alt) {
                eventLoop.dispatch({
                    type: 'notice.set',
                    notice: 'Ctrl+S Session  Ctrl+O Model  Ctrl+N New  Ctrl+F File  Ctrl+K Commands  Ctrl+L Logs  @ Complete  Ctrl+? Help  ↑↓ Enter Esc in overlay',
                });
                continue;
            }
            if (input.type === 'key' && input.key === 'n' && input.ctrl && !input.alt) {
                eventLoop.dispatch({ type: 'editor.reset' });
                eventLoop.renderNow();
                if (attachBaseUrl) {
                    const remote = agentService as RemoteTuiAgentService;
                    void (async () => {
                        try {
                            const created = await remote.createSession(settings.dir);
                            activeSessionId = created.id;
                            eventLoop.dispatch({
                                type: 'session.restored',
                                sessionId: created.id,
                                title: created.title,
                                messages: [],
                            });
                            eventLoop.dispatch({ type: 'notice.set', notice: `New session: ${created.title}` });
                        } catch (err) {
                            eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                        }
                        await eventLoop.renderNow();
                    })();
                } else {
                    activeSessionId = undefined;
                    eventLoop.dispatch({ type: 'session.new' });
                }
                continue;
            }
            if (input.type === 'key' && input.key === 'o' && input.ctrl && !input.alt) {
                const loadedConfig = new ConfigManager().load({ cwd: settings.dir });
                const { config } = resolveConfigWithEnvOverrides(loadedConfig);
                const current = st.model ?? settings.model ?? config.llm.model;
                const providers = [...SUPPORTED_LLM_PROVIDERS];
                let providerIndex = providers.findIndex((p) => getDefaultModelForProvider(p) === current || getKnownModelsForProvider(p).includes(current));
                if (providerIndex < 0) providerIndex = 0;
                const items = getKnownModelsForProvider(providers[providerIndex]! as LLMProviderName).map((id) => ({ id, label: id }));
                eventLoop.dispatch({ type: 'overlay.open', kind: 'model', providers, providerIndex, items });
                continue;
            }

            if (input.type === 'key' && input.key === 'v' && input.alt && !input.ctrl) {
                const content = readFromClipboard();
                if (content) {
                    const normalized = content.replace(/\r\n?/g, '\n');
                    eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: normalized, raw: '' } });
                    if (!normalized.includes('\n')) showPasteHint(normalized);
                }
                continue;
            }

            if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
                if (sawFollowUpAfterEnter) {
                    eventLoop.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
                } else {
                    enterSubmitTimer = setTimeout(() => {
                        enterSubmitTimer = null;
                        void submitEditor();
                    }, ENTER_SUBMIT_DELAY_MS);
                }
                continue;
            }

            if (
                (input.type === 'key' && input.key === 'c' && (input.alt || (input.ctrl && input.shift)) && !(input.ctrl && input.alt))
            ) {
                const st = eventLoop.getState();
                if (st.viewport.selection) {
                    const text = buildViewportSelectedText(st.transcriptLines, st.viewport.selection).trimEnd();
                    if (text.length > 0) {
                        const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        writeToClipboardOSC52(text, process.stdout);
                        getClipboardService().writeText(text).then(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 5000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 5000);
                        }).catch(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 5000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 5000);
                        });
                    }
                    continue;
                }
                const targetAtFocus = st.viewport.focusLine != null ? getCopyTargetAtLine(st, st.viewport.focusLine) : null;
                const target = targetAtFocus ?? getFirstVisibleCodeBlockTarget(st);
                if (target) {
                    void copyTarget(st, target, getClipboardService(), (e) => eventLoop.dispatch(e), process.stdout).then(() =>
                        eventLoop.renderNow(),
                    );
                }
                continue;
            }

            if (input.type === 'key' && input.key === 'y' && !input.ctrl && !input.alt) {
                const st = eventLoop.getState();
                if (st.viewport.selection) {
                    const text = buildViewportSelectedText(st.transcriptLines, st.viewport.selection).trimEnd();
                    if (text.length > 0) {
                        const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        writeToClipboardOSC52(text, process.stdout);
                        getClipboardService().writeText(text).then(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 5000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 5000);
                        }).catch(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 5000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 5000);
                        });
                    }
                    continue;
                }
                const targetAtFocus = st.viewport.focusLine != null ? getCopyTargetAtLine(st, st.viewport.focusLine) : null;
                const target = targetAtFocus ?? (input.shift ? getFirstVisibleCodeBlockTarget(st) : { kind: 'message-latest-assistant' as const });
                if (target) {
                    void copyTarget(st, target, getClipboardService(), (e) => eventLoop.dispatch(e), process.stdout).then(() =>
                        eventLoop.renderNow(),
                    );
                }
                continue;
            }

            if (input.type === 'mouse' && input.kind === 'press' && input.button === 'left') {
                const st = eventLoop.getState();
                const row = input.y - 1;
                const col = input.x - 1;
                const layout = computeLayout(st);
                const editorView = getEditorViewModel(st.editor);
                const contentX = (layout.innerLeft ?? 0) + 1;
                let editorRow = layout.editorY + 1;
                if (st.editor.attachments.length > 0) editorRow += 1;
                const contentWidth = layout.editorContentWidth ?? Math.max(10, (layout.innerWidth ?? layout.mainWidth) - 4);
                const visibleLines = editorView.visibleLines.length > 0 ? editorView.visibleLines : [st.editor.placeholder];
                const cursorLineIndex = editorView.cursor.line - editorView.visibleStartRow;
                const scrollCol = Math.max(0, editorView.cursor.column - contentWidth + 1);

                if (row >= editorRow && row < editorRow + visibleLines.length && col >= contentX) {
                    const lineIndex = row - editorRow;
                    const displayColInVisible = Math.max(0, col - (contentX + 2));
                    const startCol = lineIndex === cursorLineIndex ? scrollCol : 0;
                    const fullDisplayCol = startCol + displayColInVisible;
                    const lines = st.editor.value.length === 0 ? [''] : st.editor.value.split('\n');
                    const logicalLineIndex = editorView.visibleStartRow + lineIndex;
                    if (logicalLineIndex < lines.length) {
                        const line = lines[logicalLineIndex] ?? '';
                        const offsetInLine = characterIndexAtDisplayColumn(line, fullDisplayCol);
                        let lineStartOffset = 0;
                        for (let i = 0; i < logicalLineIndex; i += 1) {
                            lineStartOffset += (lines[i]?.length ?? 0) + 1;
                        }
                        const newOffset = Math.min(st.editor.value.length, lineStartOffset + offsetInLine);
                        eventLoop.dispatch({ type: 'editor.set-value', value: st.editor.value, cursorOffset: newOffset });
                    }
                    continue;
                }

                const transcriptStartRow = layout.transcriptStartRow ?? 3;
                const scrollbarCol = layout.scrollbarCol;
                const copyButtonLeft = scrollbarCol - 12;
                const transcriptH = layout.transcriptHeight ?? 10;
                const leftCol = layout.innerLeft ?? 0;

                const inScrollbar = (col === scrollbarCol || col === scrollbarCol + 1) && row >= transcriptStartRow && row < transcriptStartRow + transcriptH;
                if (inScrollbar) {
                    const scrollbar = buildScrollbarModel(st.transcriptLines.length, transcriptH, st.viewport.topLine);
                    if (scrollbar.visible) {
                        const pointerRowInTrack = row - transcriptStartRow;
                        const onThumb = pointerRowInTrack >= scrollbar.thumbTop && pointerRowInTrack < scrollbar.thumbTop + scrollbar.thumbHeight;
                        if (onThumb) {
                            scrollbarDragOffset = pointerRowInTrack - scrollbar.thumbTop;
                        } else {
                            const topLine = resolveViewportTopLineFromScrollbar(
                                st.transcriptLines.length,
                                transcriptH,
                                pointerRowInTrack,
                                0,
                            );
                            eventLoop.dispatch({ type: 'viewport.topLine.set', topLine });
                            eventLoop.renderNow();
                        }
                    }
                    continue;
                }

                if (row >= transcriptStartRow && col >= copyButtonLeft && col < scrollbarCol) {
                    const lineIndex = st.viewport.topLine + (row - transcriptStartRow);
                    const block = st.transcriptCodeBlocks.find((b) => b.startLine === lineIndex);
                    if (block) {
                        void copyTarget(
                            st,
                            { kind: 'code-block', blockId: block.id },
                            getClipboardService(),
                            (e) => eventLoop.dispatch(e),
                            process.stdout,
                        ).then(() => eventLoop.renderNow());
                    }
                    continue;
                }

                if (row >= transcriptStartRow && row < transcriptStartRow + transcriptH && col >= leftCol && col < copyButtonLeft) {
                    const line = st.viewport.topLine + (row - transcriptStartRow);
                    const column = Math.max(0, col - leftCol);
                    selectionAnchor = { line, column };
                    eventLoop.dispatch({ type: 'viewport.focusLine.set', line });
                    eventLoop.dispatch({
                        type: 'viewport.selection.set',
                        selection: { start: { line, column }, end: { line, column } },
                    });
                    continue;
                }
                continue;
            }

            if (input.type === 'mouse' && input.kind === 'drag' && input.button === 'left' && scrollbarDragOffset !== null) {
                const st = eventLoop.getState();
                const layout = computeLayout(st);
                const transcriptStartRow = layout.transcriptStartRow ?? 3;
                const transcriptH = layout.transcriptHeight ?? 10;
                const pointerRowInTrack = (input.y - 1) - transcriptStartRow;
                const topLine = resolveViewportTopLineFromScrollbar(
                    st.transcriptLines.length,
                    transcriptH,
                    pointerRowInTrack,
                    scrollbarDragOffset,
                );
                eventLoop.dispatch({ type: 'viewport.topLine.set', topLine });
                eventLoop.renderNow();
                continue;
            }

            if (input.type === 'mouse' && input.kind === 'drag' && input.button === 'left' && selectionAnchor !== null) {
                const st = eventLoop.getState();
                const layout = computeLayout(st);
                const transcriptStartRow = layout.transcriptStartRow ?? 3;
                const transcriptH = layout.transcriptHeight ?? 10;
                const leftCol = layout.innerLeft ?? 0;
                const row = input.y - 1;
                const col = input.x - 1;
                if (row >= transcriptStartRow && row < transcriptStartRow + transcriptH) {
                    const line = Math.max(0, Math.min(st.transcriptLines.length - 1, st.viewport.topLine + (row - transcriptStartRow)));
                    const column = Math.max(0, col - leftCol);
                    eventLoop.dispatch({ type: 'viewport.focusLine.set', line });
                    eventLoop.dispatch({
                        type: 'viewport.selection.set',
                        selection: { start: selectionAnchor, end: { line, column } },
                    });
                }
                continue;
            }

            if (input.type === 'mouse' && input.kind === 'release' && input.button === 'left') {
                const wasScrollbarDrag = scrollbarDragOffset !== null;
                scrollbarDragOffset = null;
                if (wasScrollbarDrag) {
                    selectionAnchor = null;
                    continue;
                }
                const st = eventLoop.getState();
                if (st.viewport.selection) {
                    const text = buildViewportSelectedText(st.transcriptLines, st.viewport.selection).trimEnd();
                    if (text.length > 0) {
                        const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        writeToClipboardOSC52(text, process.stdout);
                        getClipboardService().writeText(text).then(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 3000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 3000);
                        }).catch(() => {
                            eventLoop.dispatch({ type: 'toast.push', id: toastId, text: 'Copied to clipboard', kind: 'success', ttl: 3000 });
                            eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                            eventLoop.renderNow();
                            setTimeout(() => eventLoop.dispatch({ type: 'toast.dismiss', id: toastId }), 3000);
                        });
                    } else {
                        eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                    }
                }
                selectionAnchor = null;
                continue;
            }

            if (input.type === 'key' && input.key === 'l' && input.ctrl && !input.alt) {
                eventLoop.dispatch({ type: 'page.toggle' });
                continue;
            }

            // 滚轮与键盘滚动：主区为 Logs 时滚动 logViewport，否则 viewport
            const VIEWPORT_SCROLL_STEP = 3;
            const mainPage = eventLoop.getState().page;
            const scrollEv = (delta: number) => mainPage === 'logs'
                ? { type: 'logViewport.scroll' as const, delta }
                : { type: 'viewport.scroll' as const, delta };
            const pageEv = (dir: 'up' | 'down') => mainPage === 'logs'
                ? { type: 'logViewport.page' as const, direction: dir }
                : { type: 'viewport.page' as const, direction: dir };
            if (input.type === 'mouse' && (input.button === 'wheelUp' || input.button === 'wheelDown')) {
                eventLoop.dispatch(scrollEv(input.button === 'wheelUp' ? -VIEWPORT_SCROLL_STEP : VIEWPORT_SCROLL_STEP));
                continue;
            }
            if (input.type === 'key') {
                if (input.key === 'escape') {
                    const st = eventLoop.getState();
                    if (st.viewport.selection) {
                        eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                        selectionAnchor = null;
                        continue;
                    }
                }
                if (input.key === 'up' && input.shift) {
                    eventLoop.dispatch(scrollEv(-VIEWPORT_SCROLL_STEP));
                    continue;
                }
                if (input.key === 'down' && input.shift) {
                    eventLoop.dispatch(scrollEv(VIEWPORT_SCROLL_STEP));
                    continue;
                }
                if (input.key === 'home') {
                    eventLoop.dispatch(mainPage === 'logs' ? { type: 'logViewport.home' } : { type: 'viewport.home' });
                    continue;
                }
                if (input.key === 'end') {
                    eventLoop.dispatch(mainPage === 'logs' ? { type: 'logViewport.end' } : { type: 'viewport.end' });
                    continue;
                }
                if (input.key === 'pageup') {
                    eventLoop.dispatch(pageEv('up'));
                    continue;
                }
                if (input.key === 'pagedown') {
                    eventLoop.dispatch(pageEv('down'));
                    continue;
                }
            }

            if (input.type === 'text' && input.text === '@') {
                const s = eventLoop.getState();
                if (!s.overlay) {
                    const cwd = s.cwd ?? settings.dir;
                    const items = loadFilepickerEntries(cwd);
                    eventLoop.dispatch({ type: 'overlay.open', kind: 'complete', currentDir: cwd, items });
                    continue;
                }
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

                void (async () => {
                    await new Promise<void>((r) => setImmediate(r));
                    if (!hasInitFlag(settings.dir)) {
                        eventLoop.dispatch({
                            type: 'overlay.open',
                            kind: 'init',
                            items: [
                                { id: 'init', label: 'Initialize — analyze codebase and create XQoder.md' },
                                { id: 'skip', label: 'Skip — don\'t ask again' },
                            ],
                        });
                        await eventLoop.renderNow();
                    }
                })();

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
            if (enterSubmitTimer != null) {
                clearTimeout(enterSubmitTimer);
                enterSubmitTimer = null;
            }
            if (quitConfirmTimer != null) {
                clearTimeout(quitConfirmTimer);
                quitConfirmTimer = null;
            }
            try { stdin.off('data', onData); } catch { /* ignore */ }
            try { stdout.off('resize', onResize); } catch { /* ignore */ }
            await agentService.dispose();
            leaveTerminal(stdout);
        }
    } finally {
        restoreNoiseGuards();
    }
}
