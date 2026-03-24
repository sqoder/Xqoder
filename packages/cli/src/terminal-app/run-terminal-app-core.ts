import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { getXQoderPaths, ConfigManager, logger, resolveConfigWithEnvOverrides, getKnownModelsForProvider, executeCustomCommand, loadTuiConfig, writeTuiConfig, resolveCustomCommand, type MessageAttachment, type SandboxMode, type LLMProviderName } from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/agent';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { TerminalEventLoop } from '../terminal-core/event-loop.js';
import { type TerminalInputEvent } from '../terminal-core/input-parser.js';
import { renderTerminalFrame } from '../terminal-core/renderer.js';
import { getTheme, TERMINAL_THEME_IDS, TERMINAL_THEME_LABELS } from '../terminal-core/index.js';
import { ProtocolRuntimeBridge, reduceTerminalRuntimeResize, restoreTerminalHistory } from '../terminal-core/runtime-bridge.js';
import { RustRendererAdapter } from '../terminal-core/rust-renderer.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import { readFromClipboard } from '../terminal-core/clipboard.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import { TuiAgentService, RemoteTuiAgentService, type LocalTuiSessionStore, type TuiAgentSettings } from '../tui/agent-service.js';
import { reduceTerminalAppState } from './reducer.js';
import { InterruptManager } from './interrupt-manager.js';
import { InputController, resolveShortcutIntent } from './input-controller.js';
import { OverlayController } from './overlay-controller.js';
import { OverlaySelectionController } from './overlay-selection-controller.js';
import { CopySelectionController } from './copy-selection-controller.js';
import { MouseSelectionController } from './mouse-selection-controller.js';
import { SessionController } from './session-controller.js';
import { ShortcutController } from './shortcut-controller.js';
import { ViewportScrollController } from './viewport-scroll-controller.js';
import { createSubmitController } from './submit-controller.js';
import { InteractionGateController } from './interaction-gate-controller.js';
import { EditorKeyController } from './editor-key-controller.js';
import { AutocompleteController, resolveAutocompleteOverlayIntent } from './autocomplete-controller.js';
import { MessageJumpController } from './message-jump-controller.js';
import { OverlayLayerController } from './overlay-layer-controller.js';
import {
    formatAttachmentLabel,
    hasInitFlag,
    inferAttachmentKind,
    loadCompleteSearchEntries,
    loadFilepickerEntries,
    markProjectInitialized,
    parsePatchedPathFromLine,
    recordCompleteSelection,
    resolveFilepickerInputPath,
} from './terminal-app-helpers.js';
import {
    enterTerminal,
    installTerminalNoiseGuards,
    leaveTerminal,
    withRawMode,
} from './terminal-runtime.js';
import {
    tryHandleEditorCommand,
} from './editor-command-runner.js';
import {
    listLocalResolvedSessions,
    resolveInitialTerminalSession,
    restoreSelectedTerminalSession,
} from './session-runner.js';

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
type VimMode = 'insert' | 'normal';

const HELP_OVERLAY_ITEMS: Array<{ key: string; description: string; section?: 'Session' | 'Editor' | 'Navigation' | 'Global'; weight?: number }> = [
    { key: 'Ctrl+S', description: 'Session list', section: 'Session', weight: 1 },
    { key: 'Ctrl+K/Ctrl+P', description: 'Command palette', section: 'Session', weight: 2 },
    { key: 'Ctrl+O', description: 'Model picker', section: 'Session', weight: 3 },
    { key: 'Ctrl+F', description: 'File picker', section: 'Session', weight: 4 },
    { key: 'Ctrl+N', description: 'New session', section: 'Session', weight: 5 },
    { key: '@', description: 'Reference completion', section: 'Session', weight: 6 },
    { key: 'Ctrl+T', description: 'Theme picker', section: 'Session', weight: 7 },
    { key: 'Enter', description: 'Send', section: 'Editor', weight: 1 },
    { key: 'Shift/Ctrl/Alt+Enter', description: 'New line', section: 'Editor', weight: 2 },
    { key: 'Ctrl+E', description: 'External editor', section: 'Editor', weight: 3 },
    { key: 'Ctrl+A/Ctrl+E', description: 'Line start/end', section: 'Editor', weight: 4 },
    { key: 'Alt+B/Alt+F', description: 'Move by word', section: 'Editor', weight: 5 },
    { key: 'Ctrl+B/Ctrl+F', description: 'Move by char', section: 'Editor', weight: 6 },
    { key: 'Ctrl+K/Ctrl+U/Ctrl+W', description: 'Delete chunks', section: 'Editor', weight: 7 },
    { key: 'Ctrl+J', description: 'New line', section: 'Editor', weight: 8 },
    { key: 'Ctrl+G/Home', description: 'Top', section: 'Navigation', weight: 1 },
    { key: 'Ctrl+Alt+G/End', description: 'Bottom', section: 'Navigation', weight: 2 },
    { key: 'Ctrl+Alt+U/D', description: 'Half-page', section: 'Navigation', weight: 3 },
    { key: 'Ctrl+Alt+Y/E', description: 'Line scroll', section: 'Navigation', weight: 4 },
    { key: 'Ctrl+↑/Ctrl+↓', description: 'Message jump', section: 'Navigation', weight: 4.5 },
    { key: 'Ctrl+L', description: 'Toggle logs', section: 'Navigation', weight: 5 },
    { key: 'Enter', description: 'Jump patched path', section: 'Navigation', weight: 6 },
    { key: 'y', description: 'Copy patched path', section: 'Navigation', weight: 7 },
    { key: 'Esc', description: 'Close/cancel', section: 'Global', weight: 1 },
    { key: 'Ctrl+C', description: 'Interrupt/exit', section: 'Global', weight: 2 },
    { key: 'Ctrl+?', description: 'Open help', section: 'Global', weight: 3 },
    { key: 'Ctrl+]', description: 'Toggle Vim mode', section: 'Global', weight: 4 },
];

function resolveSettings(options: TerminalAppOptions): TuiAgentSettings {
    const resolvedDir = path.resolve(options.dir ?? process.cwd());
    const loadedConfig = new ConfigManager().load({ cwd: resolvedDir });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);

    return {
        dir: resolvedDir,
        model: options.model ?? config.llm.model,
        agent: options.agent ?? config.defaultAgent ?? 'general',
        sandboxMode: options.sandboxMode ?? config.sandbox?.mode ?? 'full-access',
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
        let settings = resolveSettings(options);
        const attachBaseUrl = options.attachBaseUrl?.replace(/\/$/, '');
        let sandboxUpgradePromptPending = options.sandboxMode === undefined
            && !attachBaseUrl
            && settings.sandboxMode === 'project';
        const sessionStore = attachBaseUrl ? null : new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
        const agentService = attachBaseUrl
            ? new RemoteTuiAgentService(attachBaseUrl, process.env.XQODER_SERVER_PASSWORD
                ? { username: process.env.XQODER_SERVER_USERNAME ?? 'xqoder', password: process.env.XQODER_SERVER_PASSWORD }
                : undefined)
            : new TuiAgentService(sessionStore!);
        const {
            restoredSessionId,
            restoredSession,
            restoredSummary,
        } = await resolveInitialTerminalSession({
            agentService,
            attachBaseUrl,
            sessionStore,
            settings,
            session: options.session,
            continue: options.continue,
        });
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
        render: (state) => {
            renderTerminalFrame(state);
        },
    });
        const bridge = new ProtocolRuntimeBridge((event) => eventLoop.dispatch(event));

        let activeSessionId: string | undefined = restoredSession?.id;
        let disposed = false;
        let pendingApprovalResolve: ((approved: boolean) => void) | null = null;
        let pendingQuestionResolve: ((answer: { requestId: string; selected: string[]; customText?: string }) => void) | null = null;
        /** 当前 session 内是否已选择「Always allow in this session」 */
        let autoApproveToolsForSession = false;
        let enterSubmitTimer: ReturnType<typeof setTimeout> | null = null;
        let pasteHintClearTimer: ReturnType<typeof setTimeout> | null = null;
        let lastRuntimePulseAt = 0;
        let interruptManager: InterruptManager | null = null;
        let vimMode: VimMode = 'insert';
        const customCommandArgHistory = new Map<string, Record<string, string>>();
        let completeQuery = '';
        let completeRootDir: string | null = null;
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

        if (sandboxUpgradePromptPending) {
            eventLoop.dispatch({
                type: 'notice.set',
                notice: 'Legacy sandbox mode detected (project). Press Y to upgrade to full-access, N to keep current.',
            });
        }

        const submitController = createSubmitController({
            eventLoop,
            bridge,
            agentService,
            sessionStore,
            attachBaseUrl,
            getSettings: () => settings,
            getActiveSessionId: () => activeSessionId,
            setActiveSessionId: (sessionId) => {
                activeSessionId = sessionId;
            },
            isAutoApproveToolsForSession: () => autoApproveToolsForSession,
            getPendingApprovalResolve: () => pendingApprovalResolve,
            setPendingApprovalResolve: (resolve) => {
                pendingApprovalResolve = resolve;
            },
            getPendingQuestionResolve: () => pendingQuestionResolve,
            setPendingQuestionResolve: (resolve) => {
                pendingQuestionResolve = resolve;
            },
            maxTerminalAttachments: MAX_TERMINAL_ATTACHMENTS,
            formatAttachmentLabel,
            inferAttachmentKind,
            tryHandleEditorCommand: (prompt) => tryHandleEditorCommand(prompt, settings.dir, eventLoop, {
                sessionStore,
                agentService,
                attachBaseUrl,
                settings,
                getActiveSessionId: () => activeSessionId,
                setActiveSessionId: (id) => { activeSessionId = id; },
            getInterruptManager: () => interruptManager,
            maxTerminalAttachments: MAX_TERMINAL_ATTACHMENTS,
            formatAttachmentLabel,
            inferAttachmentKind,
        }),
        });

        const submitEditor = submitController.submitEditor;
        const submitInitPrompt = submitController.submitInitPrompt;
        const cancelCurrentLLMRequest = submitController.cancelCurrentLLMRequest;

        const exitTerminalNow = (): void => {
            disposed = true;
        };

        interruptManager = new InterruptManager({
            isLLMRunning: () => {
                const status = eventLoop.getState().runtimeStatus;
                return status === 'thinking' || status === 'running-tool' || status === 'awaiting-approval';
            },
            onCancelLLM: cancelCurrentLLMRequest,
            onExit: exitTerminalNow,
        });
        interruptManager.register();

        const mouseSelectionController = new MouseSelectionController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            renderNow: () => eventLoop.renderNow(),
            stdout,
        });

        const copySelectionController = new CopySelectionController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            renderNow: () => eventLoop.renderNow(),
            parsePatchedPathFromLine,
            stdout,
        });

        const viewportScrollController = new ViewportScrollController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            getState: () => eventLoop.getState(),
            renderNow: () => eventLoop.renderNow(),
        });
        const messageJumpController = new MessageJumpController({
            getState: () => eventLoop.getState(),
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
        });
        const autocompleteController = new AutocompleteController();

        const interactionGateController = new InteractionGateController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
        });

        const editorKeyController = new EditorKeyController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            renderNow: () => eventLoop.renderNow(),
            getState: () => eventLoop.getState(),
            settingsDir: settings.dir,
            parsePatchedPathFromLine,
            loadFilepickerEntries,
            readClipboard: () => readFromClipboard() ?? undefined,
            showPasteHint,
            submitEditor,
            setEnterSubmitTimer: (timer) => {
                enterSubmitTimer = timer;
            },
            stdout,
            enterSubmitDelayMs: ENTER_SUBMIT_DELAY_MS,
        });

        const inputController = new InputController({
            onCtrlC: () => {
                interruptManager?.onCtrlCByte();
            },
            readClipboard: () => readFromClipboard() ?? undefined,
            onPaste: (content) => {
                eventLoop.dispatch({ type: 'input', input: { type: 'paste', text: content, raw: '' } });
                if (!content.includes('\n')) {
                    showPasteHint(content);
                }
            },
            onEscape: () => {
                const state = eventLoop.getState();
                if (state.overlay) {
                    if (state.overlay.type === 'init') {
                        markProjectInitialized(settings.dir);
                    }
                    eventLoop.dispatch({ type: 'overlay.close' });
                    return true;
                }
                if (state.viewport.selectedRange) {
                    eventLoop.dispatch({ type: 'viewport.selection.set', selection: null });
                    mouseSelectionController.clearSelectionAnchor();
                    return true;
                }
                return false;
            },
        });

        const appendAttachmentFromPath = (resolvedPath: string): boolean => {
            const state = eventLoop.getState();
            if (state.editor.attachments.length >= MAX_TERMINAL_ATTACHMENTS) {
                eventLoop.dispatch({ type: 'notice.set', notice: `Attachment limit (${MAX_TERMINAL_ATTACHMENTS})` });
                return false;
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
            return true;
        };

        const overlayController = new OverlayController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            getState: () => eventLoop.getState(),
            loadFilepickerEntries,
            loadCompleteSearchEntries,
            recordCompleteSelection,
            resolveFilepickerInputPath,
            appendAttachment: appendAttachmentFromPath,
            executeArgumentsCommand: (commandName, values) => {
                customCommandArgHistory.set(commandName, { ...values });
                const custom = resolveCustomCommand(commandName, settings.dir);
                if (!custom) {
                    return;
                }
                try {
                    const out = executeCustomCommand(custom, values);
                    eventLoop.dispatch({ type: 'notice.set', notice: out ? out.slice(0, 80) + (out.length > 80 ? '…' : '') : 'Done' });
                } catch (err) {
                    eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                }
            },
            setNotice: (notice) => eventLoop.dispatch({ type: 'notice.set', notice }),
        });

        const overlayLayerController = new OverlayLayerController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            onDismissInit: () => {
                markProjectInitialized(settings.dir);
            },
        });

        const overlaySelectionController = new OverlaySelectionController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            loadKnownModelsForProvider: (provider) =>
                getKnownModelsForProvider(provider as LLMProviderName).map((id) => ({ id, label: id })),
            loadFilepickerEntries,
            appendAttachment: appendAttachmentFromPath,
            recordCompleteSelection,
            executeArgumentsCommand: (commandName, values) => {
                customCommandArgHistory.set(commandName, { ...values });
                const custom = resolveCustomCommand(commandName, settings.dir);
                if (!custom) {
                    return;
                }
                try {
                    const out = executeCustomCommand(custom, values);
                    eventLoop.dispatch({ type: 'notice.set', notice: out ? out.slice(0, 80) + (out.length > 80 ? '…' : '') : 'Done' });
                } catch (err) {
                    eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                }
            },
            onSelectSession: (sessionItem) => {
                eventLoop.renderNow();
                void (async () => {
                    await restoreSelectedTerminalSession(sessionItem.id, sessionItem.title, eventLoop, {
                        agentService,
                        attachBaseUrl,
                        sessionStore,
                        settings,
                        setActiveSessionId: (sessionId) => {
                            activeSessionId = sessionId;
                        },
                    });
                    await eventLoop.renderNow();
                })();
            },
            onSelectModel: (modelItem) => {
                eventLoop.dispatch({ type: 'model.set', model: modelItem.id });
                eventLoop.dispatch({ type: 'notice.set', notice: `Model: ${modelItem.id}` });
            },
            onSelectTheme: (themeItem) => {
                try { writeTuiConfig({ theme: themeItem.id }); } catch { /* ignore */ }
                eventLoop.dispatch({ type: 'notice.set', notice: `Theme: ${themeItem.id}` });
            },
            onSelectInit: (itemId) => {
                markProjectInitialized(settings.dir);
                if (itemId === 'init') {
                    submitInitPrompt();
                }
            },
            onSelectCommand: (commandItem) => {
                shortcutController.runPaletteCommand(commandItem.id, eventLoop.getState().model ?? settings.model);
            },
            onDismissInit: () => {
                markProjectInitialized(settings.dir);
            },
        });

        const sessionController = new SessionController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            renderNow: () => eventLoop.renderNow(),
            listLocalSessions: (dir, limit) => listLocalResolvedSessions(sessionStore!, dir, settings, limit),
            listRemoteSessions: async (dir, limit) => {
                const remote = agentService as RemoteTuiAgentService;
                return remote.listSessions(dir, limit);
            },
            createRemoteSession: async (dir) => {
                const remote = agentService as RemoteTuiAgentService;
                return remote.createSession(dir);
            },
            setActiveSessionId: (sessionId) => {
                activeSessionId = sessionId;
            },
        });

        const shortcutController = new ShortcutController({
            dispatch: (event) => eventLoop.dispatch(event as TerminalCoreEvent),
            settingsDir: settings.dir,
            attachBaseUrl,
            loadFilepickerEntries,
            markProjectInitialized,
            helpItems: HELP_OVERLAY_ITEMS,
            themeItems: TERMINAL_THEME_IDS.map((id) => ({ id, label: TERMINAL_THEME_LABELS[id] ?? id })),
            sessionController,
            onInterrupt: () => interruptManager?.onCtrlCKey(),
            onQuit: () => {
                disposed = true;
                stdin.off('data', onData);
                void agentService.dispose().finally(() => leaveTerminal(stdout));
            },
            resolveCustomCommand: (id) => resolveCustomCommand(id, settings.dir),
            executeCustomCommand: (custom, values) => executeCustomCommand(custom as any, values),
            getCustomArgHistory: (id) => customCommandArgHistory.get(id),
            setCustomArgHistory: (id, values) => {
                customCommandArgHistory.set(id, values);
            },
            getActiveSessionId: () => activeSessionId,
        });

        const onData = (chunk: string | Buffer): void => {
        let text = typeof chunk === 'string' ? chunk : decoder.write(chunk);

        // --- RUST MOUSE REDIRECT ---
        if (text.startsWith('\x1b[<')) {
            const st = eventLoop.getState();
            const inputLines = Math.max(1, Math.min(6, st.editor.value.split('\n').length));
            if (rustTui.handleMouse(text, inputLines)) {
                eventLoop.dispatch({ type: st.page === 'chat' ? 'viewport.sync' : 'logViewport.sync' });
                return;
            }
        }

        let sawFollowUpAfterEnter = false;
        if (enterSubmitTimer != null) {
            clearTimeout(enterSubmitTimer);
            enterSubmitTimer = null;
            eventLoop.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
            sawFollowUpAfterEnter = true;
        }

        const consumed = inputController.consumeDecodedChunk(text);
        if (consumed.handled) {
            return;
        }
        const events: TerminalInputEvent[] = consumed.events;

        for (const input of events) {
            const currentState = eventLoop.getState();
            const shortcutIntent = resolveShortcutIntent(input, currentState);
            if (shortcutIntent) {
                const handledShortcut = shortcutController.handleIntent(shortcutIntent, currentState, {
                    completeQuery,
                    completeRootDir,
                });
                if (handledShortcut.handled) {
                    completeQuery = handledShortcut.state.completeQuery;
                    completeRootDir = handledShortcut.state.completeRootDir;
                    continue;
                }
            }

            const gateHandled = interactionGateController.handle(input, currentState, {
                sandboxUpgradePromptPending,
                autoApproveToolsForSession,
                pendingApprovalResolve,
                pendingQuestionResolve,
                settings,
            });
            if (gateHandled.handled) {
                sandboxUpgradePromptPending = gateHandled.state.sandboxUpgradePromptPending;
                autoApproveToolsForSession = gateHandled.state.autoApproveToolsForSession;
                pendingApprovalResolve = gateHandled.state.pendingApprovalResolve;
                pendingQuestionResolve = gateHandled.state.pendingQuestionResolve;
                settings = gateHandled.state.settings;
                continue;
            }
            sandboxUpgradePromptPending = gateHandled.state.sandboxUpgradePromptPending;
            autoApproveToolsForSession = gateHandled.state.autoApproveToolsForSession;
            pendingApprovalResolve = gateHandled.state.pendingApprovalResolve;
            pendingQuestionResolve = gateHandled.state.pendingQuestionResolve;
            settings = gateHandled.state.settings;

            const st = eventLoop.getState();
            if (st.overlay) {
                mouseSelectionController.clearSelectionAnchor();
                const overlayLayerHandled = overlayLayerController.handle(input, st, {
                    completeQuery,
                    completeRootDir,
                });
                if (overlayLayerHandled.handled) {
                    completeQuery = overlayLayerHandled.state.completeQuery;
                    completeRootDir = overlayLayerHandled.state.completeRootDir;
                    continue;
                }
                const overlayHandled = overlayController.handle(input, st, {
                    completeQuery,
                    completeRootDir,
                });
                if (overlayHandled.handled) {
                    completeQuery = overlayHandled.state.completeQuery;
                    completeRootDir = overlayHandled.state.completeRootDir;
                    continue;
                }
                const overlaySelectionHandled = overlaySelectionController.handle(input, st, {
                    completeQuery,
                    completeRootDir,
                });
                if (overlaySelectionHandled.handled) {
                    completeQuery = overlaySelectionHandled.state.completeQuery;
                    completeRootDir = overlaySelectionHandled.state.completeRootDir;
                    continue;
                }

                continue;
            }

            const editorKeyHandled = editorKeyController.handle(input, {
                vimMode,
                sawFollowUpAfterEnter,
                enterSubmitTimer,
            });
            if (editorKeyHandled.handled) {
                vimMode = editorKeyHandled.state.vimMode;
                enterSubmitTimer = editorKeyHandled.state.enterSubmitTimer;
                continue;
            }
            vimMode = editorKeyHandled.state.vimMode;
            enterSubmitTimer = editorKeyHandled.state.enterSubmitTimer;

            if (copySelectionController.handle(input, eventLoop.getState(), settings.dir)) {
                continue;
            }

            if (mouseSelectionController.handle(input, eventLoop.getState())) {
                continue;
            }

            if (input.type === 'key' && input.key === 'l' && input.ctrl && !input.alt) {
                eventLoop.dispatch({ type: 'page.toggle' });
                continue;
            }

            if (input.type === 'key' && input.key === 'tab' && !input.ctrl && !input.alt && !input.shift) {
                const current = eventLoop.getState();
                const editorIsEmpty = current.editor.value.trim().length === 0;
                const canToggleMode = editorIsEmpty
                    && current.editor.attachments.length === 0
                    && !current.pendingApproval
                    && !current.pendingQuestion
                    && !current.overlay;
                if (canToggleMode) {
                    eventLoop.dispatch({ type: 'interaction.mode.toggle' });
                    continue;
                }
            }

            if (viewportScrollController.handle(input)) {
                if (input.type === 'key' && input.key === 'escape') {
                    mouseSelectionController.clearSelectionAnchor();
                }
                continue;
            }

            if (messageJumpController.handle(input)) {
                continue;
            }

            if (input.type === 'text' && !eventLoop.getState().overlay) {
                const s = eventLoop.getState();
                const before = s.editor.value;
                const cursor = s.editor.cursorOffset;
                const nextText = before.slice(0, cursor) + input.text + before.slice(cursor);
                const nextCursor = cursor + input.text.length;
                const ac = autocompleteController.update(nextText, nextCursor);
                const acIntent = resolveAutocompleteOverlayIntent(input.text, before, ac);
                if (acIntent === 'open-complete') {
                    const cwd = s.cwd ?? settings.dir;
                    completeQuery = '';
                    completeRootDir = cwd;
                    const items = loadCompleteSearchEntries(cwd, '');
                    eventLoop.dispatch({ type: 'overlay.open', kind: 'complete', currentDir: cwd, items });
                    continue;
                }
                if (acIntent === 'open-commands') {
                    const handledCommands = shortcutController.handleIntent({ type: 'open.commands' }, s, {
                        completeQuery,
                        completeRootDir,
                    });
                    if (handledCommands.handled) {
                        completeQuery = handledCommands.state.completeQuery;
                        completeRootDir = handledCommands.state.completeRootDir;
                        continue;
                    }
                }
            }

            eventLoop.dispatch({ type: 'input', input });
        }
    };

        const onResize = (): void => {
            if (process.env.XQODER_DEBUG_TUI_SIZE === '1') {
                try {
                    process.stderr.write(`[debug] terminal-core cols=${stdout.columns ?? 120} rows=${stdout.rows ?? 40}\n`);
                } catch {
                    // ignore debug logging failures
                }
            }
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
                onResize();
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
                    const now = Date.now();
                    if (now - lastRuntimePulseAt >= 160) {
                        lastRuntimePulseAt = now;
                        eventLoop.dispatch({ type: 'timer', timerId: 'runtime-pulse', now });
                    }
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            });
        } finally {
            viewportScrollController.dispose();
            if (enterSubmitTimer != null) {
                clearTimeout(enterSubmitTimer);
                enterSubmitTimer = null;
            }
            try { stdin.off('data', onData); } catch { /* ignore */ }
            try { stdout.off('resize', onResize); } catch { /* ignore */ }
            if (interruptManager) {
                try { interruptManager.unregister(); } catch { /* ignore */ }
                interruptManager = null;
            }
            await agentService.dispose();
            leaveTerminal(stdout);
        }
    } finally {
        restoreNoiseGuards();
    }
}
