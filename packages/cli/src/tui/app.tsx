// ============================================================
// XQoder TUI — 主应用组件（OpenCode 风格单页 Chat UI）
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
    getXQoderPaths,
    ConfigManager,
    type MessageAttachment,
    type TuiMouseMode,
    type SandboxMode,
    loadCustomCommands,
    executeCustomCommand,
    getContextWindow,
} from '@xqoder/shared';
import type { AppEvent } from '@xqoder/protocol';
import { FileRollbackStore } from '@xqoder/agent';
import { SQLiteSessionStore, type PersistedSessionSummary } from '@xqoder/storage-sqlite';
import { FileSessionShareStore } from '../session-assets.js';
import { TuiAgentService } from './agent-service.js';

import {
    buildCliArgs,
    formatCliInvocation,
    getSlashCommands,
    getTuiHelpLines,
    parseTuiCommand,
    type TuiExecutableCommand,
    type TuiSettings,
} from './commands.js';
import { runCliCommand, runShellCommand, type RunningCliCommand } from './runner.js';
import { resolveSessionForTui } from '../services/session-resolve.js';
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

import { useDimensions } from './use-dimensions.js';
import { appendEditorAttachment, buildMessageAttachments, MAX_EDITOR_ATTACHMENTS } from './attachments.js';
import { createDefaultTuiShellState, type OverlayType } from './types.js';
import { INITIAL_PROTOCOL_UI_STATE, reduceProtocolEvent } from './protocol-event-reducer.js';
import { restoreChatMessagesFromSession } from './session-transcript.js';
import { setTheme } from './theme.js';
import { resolveKeybinds } from './keybinds.js';
import { closeDialogs, getVisiblePanels, isPanelVisible, openOnlyDialog, togglePage, toggleToolPanel, type ActivePanel, type ToolPanelState } from './app-shell-state.js';

import { ChatPage, type SessionUsage, type ToolExecution, type FileChange } from './layout.js';
import { buildTimelineEntries, getInitialTimelineState, getNextPanelIndex, getNextTimelineState, syncPanelSelectionFromTimeline, syncTimelineSelectionFromPanel } from './timeline.js';
import { LogsPage, logsFromStrings, type LogEntry } from './logs-page.js';

import {
    DialogOverlay,
    HelpDialog,
    ThemeDialog,
    CommandPalette,
    PermissionDialog,
    ModelSelectorDialog,
    SessionSelectorDialog,
    InitDialog,
    ContextCompletionDialog,
    QuestionDialog,
    type ContextItem,
    type QuestionAnswer,
    type QuestionRequest,
    type PermissionRequest,
} from './dialog.js';
import { FilePicker } from './file-picker.js';
import type { SessionInfo } from './sidebar.js';
import type { ChatMessage } from './message.js';

export interface XQoderTuiProps {
    initialSettings: TuiSettings;
    onRequestExit?: () => void;
}

interface PendingChatRequest {
    text: string;
    attachments: MessageAttachment[];
}

export function XQoderTui({ initialSettings, onRequestExit }: XQoderTuiProps): React.JSX.Element {
    const { exit } = useApp();
    const dims = useDimensions();

    const sessionStore = useMemo(
        () => new SQLiteSessionStore(getXQoderPaths().sessionDbFile),
        [],
    );
    const shareStore = useMemo(
        () => new FileSessionShareStore(getXQoderPaths().shareDir),
        [],
    );
    const rollbackStore = useMemo(
        () => new FileRollbackStore(getXQoderPaths().rollbackDir),
        [],
    );

    const configManager = useMemo(() => {
        const mgr = new ConfigManager();
        mgr.load();
        return mgr;
    }, []);

    const agentService = useMemo(
        () => new TuiAgentService(sessionStore),
        [sessionStore],
    );

    // ── 核心状态 ────────────────────────────────────────────
    const [settings, setSettings] = useState<TuiSettings>(initialSettings);
    const [shellState, setShellState] = useState(() => createDefaultTuiShellState());
    const [protocolUiState, setProtocolUiState] = useState(INITIAL_PROTOCOL_UI_STATE);
    const [editorValue, setEditorValue] = useState('');
    const [editorAttachments, setEditorAttachments] = useState<string[]>([]);
    const [mouseMode, setMouseMode] = useState<TuiMouseMode>('app');
    const [mouseScrollStep] = useState<number>(() => configManager.getTuiSettings().scrollStep ?? 3);
    const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
    const [questionRequest, setQuestionRequest] = useState<QuestionRequest | null>(null);
    const [activeCommand, setActiveCommand] = useState<string>();
    const [showThinking, setShowThinking] = useState(false);
    const [expandedToolIds, setExpandedToolIds] = useState<string[]>([]);
    const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
    const [diffSelectedIndex, setDiffSelectedIndex] = useState(0);
    const [timelineSelectedIndex, setTimelineSelectedIndex] = useState(0);
    const [timelineExpandedIds, setTimelineExpandedIds] = useState<string[]>([]);

    // ── Session 状态 ─────────────────────────────────────────
    const [recentSessions, setRecentSessions] = useState<PersistedSessionSummary[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string>();
    const [activeSessionTitle, setActiveSessionTitle] = useState<string>();

    // ── 日志状态 ─────────────────────────────────────────────
    const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
    const [transcriptAutoFollow, setTranscriptAutoFollow] = useState(true);

    const messages = protocolUiState.messages;
    const infoMessage = protocolUiState.infoMessage;
    const status = protocolUiState.status;
    const toolExecutions = protocolUiState.toolExecutions;
    const selectedToolExecutionIndex = protocolUiState.selectedToolExecutionIndex;

    const setMessages = useCallback((value: React.SetStateAction<ChatMessage[]>) => {
        setProtocolUiState((previous) => ({
            ...previous,
            messages: typeof value === 'function'
                ? (value as (current: ChatMessage[]) => ChatMessage[])(previous.messages)
                : value,
        }));
    }, []);

    const setInfoMessage = useCallback((value: React.SetStateAction<string>) => {
        setProtocolUiState((previous) => ({
            ...previous,
            infoMessage: typeof value === 'function'
                ? (value as (current: string) => string)(previous.infoMessage)
                : value,
        }));
    }, []);

    const setStatus = useCallback((value: React.SetStateAction<'idle' | 'running'>) => {
        setProtocolUiState((previous) => ({
            ...previous,
            status: typeof value === 'function'
                ? (value as (current: 'idle' | 'running') => 'idle' | 'running')(previous.status)
                : value,
        }));
    }, []);

    const setToolExecutions = useCallback((value: React.SetStateAction<ToolExecution[]>) => {
        setProtocolUiState((previous) => ({
            ...previous,
            toolExecutions: typeof value === 'function'
                ? (value as (current: ToolExecution[]) => ToolExecution[])(previous.toolExecutions)
                : value,
        }));
    }, []);

    const setSelectedToolExecutionIndex = useCallback((value: React.SetStateAction<number>) => {
        setProtocolUiState((previous) => ({
            ...previous,
            selectedToolExecutionIndex: typeof value === 'function'
                ? (value as (current: number) => number)(previous.selectedToolExecutionIndex)
                : value,
        }));
    }, []);

    // ── 运行中命令 ───────────────────────────────────────────
    const runningCommandRef = useRef<RunningCliCommand | undefined>(undefined);
    const pendingFileSnapshots = useRef<Map<string, string | null>>(new Map());
    const messageQueueRef = useRef<PendingChatRequest[]>([]);
    const transcriptAutoFollowRef = useRef(true);
    const messagesRef = useRef<ChatMessage[]>([]);
    const frozenTranscriptMessagesRef = useRef<ChatMessage[] | null>(null);
    const pendingPermissionApproval = useRef<{
        toolName: string;
        resolve: (approved: boolean) => void;
    } | null>(null);
    const pendingQuestionAnswer = useRef<{
        requestId: string;
        resolve: (answer: QuestionAnswer) => void;
    } | null>(null);
    const allowAllPermissions = useRef(false);

    const page = shellState.page;
    const activeOverlay = shellState.overlay;
    const visibleSidePanels = shellState.sidePanel.visiblePanels;
    const activePanel = shellState.sidePanel.focusedPanel;
    const showToolDetails = isPanelVisible(shellState.sidePanel, 'tool');
    const showDiff = isPanelVisible(shellState.sidePanel, 'diff');
    const showTimeline = isPanelVisible(shellState.sidePanel, 'timeline');
    const anyDialogOpen = activeOverlay !== null;

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const displayedMessages = transcriptAutoFollow
        ? messages
        : (frozenTranscriptMessagesRef.current ?? messages);

    const keybinds = useMemo(() => {
        const cfg = configManager.get();
        return resolveKeybinds(cfg.keybinds);
    }, [configManager]);

    const timelineEntries = useMemo(() => buildTimelineEntries({
        sessionTitle: activeSessionTitle,
        sessionId: activeSessionId,
        toolExecutions,
        fileChanges,
        systemMessages: messages.filter((message) => message.type === 'system'),
    }), [activeSessionId, activeSessionTitle, toolExecutions, fileChanges, messages]);

    useEffect(() => {
        if (!showTimeline) {
            return;
        }
        const initial = getInitialTimelineState(timelineEntries);
        setTimelineSelectedIndex((current) => Math.min(current, Math.max(0, timelineEntries.length - 1)));
        setTimelineExpandedIds((current) => current.length > 0 ? current.filter((id) => timelineEntries.some((entry) => entry.id === id)) : initial.expandedIds);
    }, [showTimeline, timelineEntries]);

    const ANSI_ESCAPE_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

    function sanitizeDisplayText(content: string): string {
        const withoutAnsi = content.replace(ANSI_ESCAPE_RE, '');
        const withoutEmoji = withoutAnsi.replace(/\p{Extended_Pictographic}/gu, '');
        return withoutEmoji
            .split('\n')
            .map(line => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
            .join('\n');
    }

    function isPathInsideProject(targetPath: string, projectRoot: string): boolean {
        const relativePath = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
        return relativePath === ''
            || (
                !relativePath.startsWith('..')
                && !path.isAbsolute(relativePath)
            );
    }

    function detectExternalAccessIntent(text: string): { requiresPrompt: boolean; preview: string } {
        if (settings.sandboxMode === 'full-access' || allowAllPermissions.current) {
            return { requiresPrompt: false, preview: '' };
        }

        const previews: string[] = [];
        const pathMatches = text.match(/(?:~\/|\/[^\s"'`<>]+)/g) ?? [];
        for (const raw of pathMatches) {
            const resolved = raw.startsWith('~/')
                ? path.join(os.homedir(), raw.slice(2))
                : raw;
            if (!isPathInsideProject(resolved, settings.dir)) {
                previews.push(resolved);
            }
        }

        const lower = text.toLowerCase();
        if (previews.length === 0 && (text.includes('桌面') || lower.includes('desktop'))) {
            const desktopPath = path.join(os.homedir(), 'Desktop');
            if (!isPathInsideProject(desktopPath, settings.dir)) {
                previews.push(desktopPath);
            }
        }

        // Fallback: if user explicitly mentions common absolute path prefixes, force prompt.
        if (previews.length === 0) {
            const hasExternalPrefix = lower.includes('/users/')
                || lower.includes('/desktop')
                || lower.includes('/downloads')
                || lower.includes('~/desktop')
                || lower.includes('~/downloads')
                || /[a-z]:\\/.test(lower);
            if (hasExternalPrefix) {
                const guess = text.includes('/Users/')
                    ? text.slice(text.indexOf('/Users/')).split(/\s+/)[0] ?? ''
                    : '';
                previews.push(guess || path.join(os.homedir(), 'Desktop'));
            }
        }

        return {
            requiresPrompt: previews.length > 0,
            preview: previews.join('\n'),
        };
    }

    function requestPermissionDialog(request: PermissionRequest): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            if (pendingPermissionApproval.current) {
                pendingPermissionApproval.current.resolve(false);
                pendingPermissionApproval.current = null;
            }

            pendingPermissionApproval.current = {
                toolName: request.toolName,
                resolve,
            };

            setPermissionRequest(request);
            openDialog('permission');
            setInfoMessage(`Permission required: ${request.toolName}`);
        });
    }

    function requestQuestionDialog(request: QuestionRequest): Promise<QuestionAnswer> {
        return new Promise<QuestionAnswer>((resolve) => {
            if (pendingQuestionAnswer.current) {
                pendingQuestionAnswer.current.resolve({
                    requestId: pendingQuestionAnswer.current.requestId,
                    selected: [],
                });
                pendingQuestionAnswer.current = null;
            }

            pendingQuestionAnswer.current = {
                requestId: request.requestId,
                resolve,
            };

            setQuestionRequest(request);
            openDialog('question');
            setInfoMessage('Question requires input');
        });
    }

    useEffect(() => {
        if (process.env.XQODER_TUI_TEST_PERMISSION_DIALOG !== '1') {
            return;
        }

        const preview = process.env.XQODER_TUI_TEST_PERMISSION_DIALOG_PATH
            ?? path.join(os.tmpdir(), 'xqoder-permission-e2e.txt');

        void requestPermissionDialog({
            toolName: 'external-path-access',
            summary: 'This request may access files outside the project directory.',
            reason: 'Test-only permission dialog trigger.',
            preview,
            risk: 'high',
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Cleanup ──────────────────────────────────────────────
    useEffect(() => {
        refreshRecentSessions();
        return () => {
            if (pendingPermissionApproval.current) {
                pendingPermissionApproval.current.resolve(false);
                pendingPermissionApproval.current = null;
            }
            if (pendingQuestionAnswer.current) {
                pendingQuestionAnswer.current.resolve({
                    requestId: pendingQuestionAnswer.current.requestId,
                    selected: [],
                });
                pendingQuestionAnswer.current = null;
            }
            runningCommandRef.current?.kill();
            agentService.dispose();
            sessionStore.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Title 生成回调 ─────────────────────────────────────────
    useEffect(() => {
        agentService.onTitleGenerated = (sessionId: string, title: string) => {
            if (sessionId === activeSessionId) {
                setActiveSessionTitle(title);
            }
            setInfoMessage(`Session: ${title}`);
            refreshRecentSessions();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSessionId, agentService]);

    // ── 启动时恢复主题 ────────────────────────────────────────
    useEffect(() => {
        const savedTheme = configManager.getThemeSetting();
        if (savedTheme) setTheme(savedTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        configManager.setTuiMouseMode('app');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 首次运行自动初始化 — 无 XQoder.md 时自动创建（不弹窗）──────
    useEffect(() => {
        const memoryFile = path.join(settings.dir, 'XQoder.md');
        if (!fs.existsSync(memoryFile)) {
            const defaultMemory = [
                '# XQoder Project Memory',
                '',
                '## Build / Test / Lint',
                '- Build: pnpm build',
                '- Test: pnpm test',
                '- Lint: pnpm lint',
                '',
                '## Notes',
                '- Keep changes minimal and scoped to user request',
                '- Prefer fixing root cause over surface workaround',
                '- Run targeted tests after code changes',
                '',
            ].join('\n');

            try {
                fs.writeFileSync(memoryFile, defaultMemory, 'utf8');
                setInfoMessage('XQoder.md initialized');
            } catch {
                // Best-effort only. If write fails, continue without blocking chat.
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 启动时恢复 session（OpenCode -c/-s）────────────────────
    useEffect(() => {
        const sid = initialSettings.initialSessionId;
        if (!sid) return;
        try {
            const resolved = resolveSessionForTui(
                sessionStore,
                initialSettings.dir,
                sid === 'latest' ? undefined : sid,
            );
            if (resolved) {
                setActiveSessionId(resolved.sessionId);
                setActiveSessionTitle(resolved.title);
                refreshRecentSessions(resolved.sessionId);
            }
        } catch {
            // ignore
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── 启动时预设 prompt（OpenCode --prompt）──────────────────
    useEffect(() => {
        const prompt = initialSettings.initialPrompt;
        if (prompt) setEditorValue(prompt);
    }, [initialSettings.initialPrompt]);

    useEffect(() => {
        refreshRecentSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.dir]);

    // ── 对话框辅助 ───────────────────────────────────────────
    function openDialog(key: OverlayType): void {
        setShellState((current) => ({
            ...current,
            overlay: openOnlyDialog(key),
        }));
    }

    function closeAllDialogs(): void {
        setShellState((current) => ({
            ...current,
            overlay: closeDialogs(),
        }));
        setPermissionRequest(null);
    }

    function getToolPanelState(): ToolPanelState {
        return {
            visiblePanels: visibleSidePanels,
            focusedPanel: activePanel,
            timelineSelectedIndex,
            timelineExpandedIds,
        };
    }

    function applyToolPanelState(nextState: ToolPanelState): void {
        setShellState((current) => ({
            ...current,
            sidePanel: {
                visiblePanels: nextState.visiblePanels,
                focusedPanel: nextState.focusedPanel,
            },
        }));
        setTimelineSelectedIndex(nextState.timelineSelectedIndex);
        setTimelineExpandedIds(nextState.timelineExpandedIds);
    }

    function updateMouseMode(nextMouseMode: TuiMouseMode): void {
        setMouseMode(nextMouseMode);
        configManager.setTuiMouseMode(nextMouseMode);
        setInfoMessage(
            nextMouseMode === 'terminal'
                ? 'Mouse → terminal (native select/copy)' 
                : 'Mouse → app (wheel scroll + native select/copy)',
        );
    }

    function addEditorAttachment(filePath: string, kind: 'file' | 'context'): void {
        const result = appendEditorAttachment(editorAttachments, filePath);
        if (result.status === 'duplicate') {
            setInfoMessage(`Attachment already added (${kind})`);
            return;
        }

        if (result.status === 'limit') {
            setInfoMessage(`Attachment limit reached (${MAX_EDITOR_ATTACHMENTS})`);
            return;
        }

        setEditorAttachments(result.attachments);
        setInfoMessage(`${kind === 'file' ? 'File attached' : 'Context added'}: ${path.basename(path.resolve(filePath))}`);
    }

    function removeEditorAttachment(index: number): void {
        setEditorAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
        setInfoMessage('Attachment removed');
    }

    function clearEditorAttachments(): void {
        setEditorAttachments([]);
        setInfoMessage('Attachments cleared');
    }

    function describeAttachmentIssue(issue: { filePath: string; reason: 'missing' | 'too_large' | 'unreadable' }): string {
        switch (issue.reason) {
            case 'missing':
                return `Attachment omitted (missing): ${issue.filePath}`;
            case 'too_large':
                return `Attachment omitted (over 5MB image limit): ${issue.filePath}`;
            case 'unreadable':
                return `Attachment omitted (unreadable): ${issue.filePath}`;
        }
    }

    function requestExit(): void {
        onRequestExit?.();
        exit();
    }

    // ── 全局快捷键（无 dialog 打开时生效）────────────────────
    useInput((input, key) => {
        // Ctrl+C — always exit immediately (no confirmation dialog)
        if (input === 'c' && key.ctrl) {
            requestExit();
            return;
        }

        // 运行中: Esc 取消 agent 或停止命令
        if (status === 'running') {
            if (key.escape) {
                if (agentService.isBusy) {
                    agentService.cancel();
                    setInfoMessage('Agent cancelled');
                    appendConsoleLog('Agent cancelled by user');
                } else {
                    appendConsoleLog('Stopping current command...');
                    runningCommandRef.current?.kill();
                }
            }
            return;
        }

        // Escape — 关闭所有对话框
        if (key.escape) {
            closeAllDialogs();
            return;
        }

        // 有 dialog 打开时，不处理全局快捷键（各 dialog 自己处理）
        if (anyDialogOpen) return;

        // Ctrl+H — 帮助（OpenCode 同款，与 Ctrl+? 等价）
        if (input === 'h' && key.ctrl) {
            openDialog('help');
            return;
        }

        // Ctrl+] (ASCII 0x1D) — 打开 session 选择面板
        if (input === '\u001d') {
            openDialog('session');
            return;
        }

        const action = keybinds.matchAction(input, key);
        if (action) {
            switch (action) {
                case 'copy': handleCopy(); return;
                case 'quit': requestExit(); return;
                case 'help': openDialog('help'); return;
                case 'theme': openDialog('theme'); return;
                case 'session': openDialog('session'); return;
                case 'newSession': createSession(); return;
                case 'model': openDialog('model'); return;
                case 'commandPalette': openDialog('commandPalette'); return;
                case 'filePicker': openDialog('filePicker'); return;
                case 'contextCompletion': openDialog('contextCompletion'); return;
                case 'logs': toggleLogsPage(); return;
                case 'mouseToggle': updateMouseMode(mouseMode === 'app' ? 'terminal' : 'app'); return;
                case 'agentCycle': {
                    const AGENTS = ['general', 'plan', 'coder'] as const;
                    const currentIdx = AGENTS.indexOf(settings.agent as (typeof AGENTS)[number]);
                    const nextIdx = (currentIdx + 1) % AGENTS.length;
                    const nextAgent = AGENTS[nextIdx] ?? 'general';
                    setSettings(s => ({ ...s, agent: nextAgent }));
                    setInfoMessage(`Agent → ${nextAgent}`);
                    return;
                }
                case 'timelineNext':
                    if (!showTimeline) handleTimelineToggle();
                    handleTimelineNavigation('next');
                    return;
                case 'timelinePrev':
                    if (!showTimeline) handleTimelineToggle();
                    handleTimelineNavigation('prev');
                    return;
                case 'timelineToggle':
                    if (!showTimeline) handleTimelineToggle();
                    handleTimelineNavigation('toggle');
                    return;
                case 'panelNext':
                    handlePanelNavigation('next');
                    return;
                case 'panelPrev':
                    handlePanelNavigation('prev');
                    return;
            }
        }
    });

    // ── 编辑器提交 ───────────────────────────────────────────
    function handleEditorSubmit(value: string): void {
        const submitted = value.trim();
        if (!submitted) return;

        const command = parseTuiCommand(submitted, settings);
        const shouldConsumeAttachments = command.type === 'execute' && command.command === 'chat';
        const preparedAttachments = shouldConsumeAttachments
            ? buildMessageAttachments(editorAttachments)
            : { attachments: [], issues: [] };
        const retainedAttachmentPaths = preparedAttachments.attachments
            .map((attachment) => attachment.filePath)
            .filter((attachment): attachment is string => typeof attachment === 'string');

        if (!shouldConsumeAttachments) {
            addMessage({
                type: 'user',
                content: submitted,
                ...(retainedAttachmentPaths.length > 0 ? { attachments: retainedAttachmentPaths } : {}),
            });
        }

        if (shouldConsumeAttachments && editorAttachments.length > 0) {
            setEditorAttachments([]);
        }

        for (const issue of preparedAttachments.issues) {
            addMessage({ type: 'system', content: describeAttachmentIssue(issue) });
        }

        switch (command.type) {
            case 'help': {
                const helpLines = getTuiHelpLines(settings);
                addMessage({ type: 'system', content: helpLines.join('\n') });
                return;
            }
            case 'clear': {
                setMessages([]);
                setConsoleLogs([]);
                setInfoMessage('Cleared.');
                return;
            }
            case 'exit': {
                requestExit();
                return;
            }
            case 'session_action':
                handleSessionAction(submitted, command);
                return;
            case 'share_action':
                handleShareAction(submitted, command);
                return;
            case 'set_dir':
                setSettings(s => ({ ...s, dir: command.dir }));
                setActiveSessionId(undefined);
                setActiveSessionTitle(undefined);
                setInfoMessage(`Dir → ${command.dir}`);
                return;
            case 'set_model':
                setSettings(s => ({ ...s, model: command.model }));
                setInfoMessage(`Model → ${command.model}`);
                return;
            case 'set_agent':
                setSettings(s => ({ ...s, agent: command.agent }));
                setInfoMessage(`Agent → ${command.agent}`);
                return;
            case 'set_scope':
                setSettings(s => ({ ...s, scope: command.scope }));
                setInfoMessage(command.scope ? `Scope → ${command.scope}` : 'Scope cleared');
                return;
            case 'set_sandbox_mode':
                setSettings(s => ({ ...s, sandboxMode: command.sandboxMode }));
                setInfoMessage(`Sandbox → ${command.sandboxMode}`);
                return;
            case 'set_mouse_mode':
                updateMouseMode(command.mouseMode);
                return;
            case 'open_dialog':
                openDialog(command.dialog);
                return;
            case 'compact':
                handleCompact();
                return;
            case 'undo':
                handleUndo();
                return;
            case 'redo':
                handleRedo();
                return;
            case 'copy':
                handleCopy();
                return;
            case 'copy_session':
                handleCopySession();
                return;
            case 'copy_code':
                handleCopyCode();
                return;
            case 'details':
                handleDetails();
                return;
            case 'diff':
                handleDiff();
                return;
            case 'timeline':
                handleTimelineToggle();
                return;
            case 'timeline_nav':
                handleTimelineNavigation(command.direction);
                return;
            case 'timeline_focus':
                handleTimelineFocus(command.panel);
                return;
            case 'logs':
                toggleLogsPage();
                return;
            case 'context':
                openDialog('contextCompletion');
                return;
            case 'custom_command':
                handleCustomCommand(command.name);
                return;
            case 'editor':
                handleEditor();
                return;
            case 'export_md':
                handleExportMd();
                return;
            case 'init':
                handleInit();
                return;
            case 'thinking':
                handleThinking();
                return;
            case 'unshare':
                handleUnshare();
                return;
            case 'connect':
                handleConnect();
                return;
            case 'error':
                addMessage({ type: 'system', content: `Error: ${command.message}` });
                return;
            case 'shell':
                handleShell(command.cmd);
                return;
            case 'execute':
                if (command.command === 'chat') {
                    handleChatMessage(command.description ?? submitted, preparedAttachments.attachments);
                } else {
                    executeCommand(submitted, command);
                }
                return;
        }
    }

    // ── In-process chat (OpenCode style) with message queue ──
    function handleChatMessage(text: string, attachments: MessageAttachment[] = []): void {
        showChatPage();
        if (status === 'running') {
            messageQueueRef.current.push({
                text,
                attachments: attachments.map((attachment) => ({ ...attachment })),
            });
            setInfoMessage(`Queued (${messageQueueRef.current.length} pending)`);
            return;
        }

        void (async () => {
            const preflight = detectExternalAccessIntent(text);
            let sandboxModeOverride: SandboxMode | undefined;
            let permissionGrantedForExternalPath = false;
            if (preflight.requiresPrompt) {
                const hadAllowAllBefore = allowAllPermissions.current;
                const approved = await requestPermissionDialog({
                    toolName: 'external-path-access',
                    summary: 'This request may access files outside the project directory.',
                    reason: 'User requested an external path operation (e.g. Desktop/system path).',
                    preview: preflight.preview,
                    risk: 'high',
                });
                if (!approved) {
                    addMessage({ type: 'system', content: 'Permission denied for external path access.' });
                    return;
                }
                permissionGrantedForExternalPath = true;
                if (!hadAllowAllBefore && !allowAllPermissions.current) {
                    sandboxModeOverride = 'full-access';
                }
            }

            const promptText = permissionGrantedForExternalPath
                ? `${text}\n\n[PermissionGranted]\nExternal path access has been approved by user for this request. Execute the requested external-path operation directly. Do not refuse with sandbox limitation text.\n[/PermissionGranted]`
                : text;
            executeChatMessage(promptText, attachments, sandboxModeOverride);
        })();
    }

    function executeChatMessage(text: string, attachments: MessageAttachment[], sandboxModeOverride?: SandboxMode): void {
        setStatus('running');
        setInfoMessage('Thinking...');
        setToolExecutions([]);
        setSelectedToolExecutionIndex(0);
        setExpandedToolIds([]);
        setFileChanges([]);
        setDiffSelectedIndex(0);
        setTimelineSelectedIndex(0);
        setTimelineExpandedIds([]);

        const finishAndProcessQueue = (): void => {
            setStatus('idle');
            const next = messageQueueRef.current.shift();
            if (next) {
                setTimeout(() => handleChatMessage(next.text, next.attachments), 100);
            }
        };

        agentService.sendMessage(
            text,
            activeSessionId,
            {
                dir: settings.dir,
                model: settings.model,
                agent: settings.agent,
                sandboxMode: sandboxModeOverride ?? settings.sandboxMode,
            },
            attachments,
            {
                onEvent: (event: AppEvent) => {
                    setProtocolUiState((previous) => reduceProtocolEvent(previous, event, {
                        sanitizeAssistantText: sanitizeDisplayText,
                    }));

                    switch (event.type) {
                        case 'tool.called': {
                            const fileModTools = ['edit', 'write', 'patch', 'str_replace'];
                            if (fileModTools.includes(event.tool)) {
                                const filePath = (event.args as Record<string, unknown>)?.file_path
                                    ?? (event.args as Record<string, unknown>)?.path;
                                if (typeof filePath === 'string') {
                                    try {
                                        const before = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
                                        pendingFileSnapshots.current.set(filePath, before);
                                    } catch { /* ignore */ }
                                }
                            }
                            if (showToolDetails) {
                                const argsPreview = JSON.stringify(event.args).slice(0, 100);
                                addMessage({ type: 'system', content: `tool: ${event.tool}(${argsPreview})` });
                            }
                            break;
                        }
                        case 'tool.output': {
                            if (event.tool === 'auto_compact' && !event.partial && event.output) {
                                const RECENT_DISPLAY_COUNT = 6;
                                setMessages(prev => {
                                    const keep = prev.slice(-RECENT_DISPLAY_COUNT);
                                    const compactBlock: ChatMessage = {
                                        id: `compact-${Date.now()}`,
                                        type: 'system',
                                        content: `Earlier conversation (compressed):\n\n${event.output}`,
                                    };
                                    return [compactBlock, ...keep];
                                });
                                setInfoMessage('Context compressed');
                            }
                            break;
                        }
                        case 'tool.completed': {
                            const fileModToolsEnd = ['edit', 'write', 'patch', 'str_replace'];
                            if (fileModToolsEnd.includes(event.tool) && event.success) {
                                for (const [fp, before] of pendingFileSnapshots.current.entries()) {
                                    try {
                                        const after = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
                                        if (before !== after) {
                                            setFileChanges(prev => {
                                                const next = [...prev, {
                                                    filePath: fp,
                                                    before,
                                                    after,
                                                    toolName: event.tool,
                                                    timestamp: new Date(),
                                                }];
                                                const capped = next.length > 30 ? next.slice(-30) : next;
                                                setDiffSelectedIndex(capped.length - 1);
                                                return capped;
                                            });
                                        }
                                    } catch { /* ignore */ }
                                }
                                pendingFileSnapshots.current.clear();
                            }
                            if (showToolDetails) {
                                addMessage({ type: 'system', content: `${event.tool}: ${event.success ? 'ok' : 'failed'}` });
                            }
                            break;
                        }
                        case 'error':
                            break;
                    }
                },
                onToolApproval: async (request) => {
                    if (allowAllPermissions.current) {
                        return true;
                    }

                    return await new Promise<boolean>((resolve) => {
                        if (pendingPermissionApproval.current) {
                            pendingPermissionApproval.current.resolve(false);
                            pendingPermissionApproval.current = null;
                        }

                        pendingPermissionApproval.current = {
                            toolName: request.toolName,
                            resolve,
                        };

                        setPermissionRequest({
                            toolCallId: request.toolCallId,
                            toolName: request.toolName,
                            summary: request.summary,
                            reason: request.reason,
                            preview: request.preview,
                            risk: request.risk,
                        });
                        openDialog('permission');
                        setInfoMessage(`Permission required: ${request.toolName}`);
                    });
                },
                onQuestion: async (request) => {
                    const answer = await requestQuestionDialog({
                        requestId: request.requestId,
                        question: request.question,
                        header: request.header,
                        options: request.options,
                        multiple: request.multiple,
                        allowCustom: request.allowCustom,
                    });
                    return {
                        requestId: answer.requestId,
                        selected: answer.selected,
                        ...(answer.customText ? { customText: answer.customText } : {}),
                    };
                },
            },
        ).then((result) => {
            setActiveSessionId(result.sessionId);
            if (result.sessionTitle) {
                setActiveSessionTitle(result.sessionTitle);
            }
            refreshRecentSessions(result.sessionId);
            setInfoMessage('Done');
            finishAndProcessQueue();
        }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage({ type: 'system', content: `Error: ${msg}` });
            setInfoMessage(`Error: ${msg.slice(0, 60)}`);
            finishAndProcessQueue();
        });
    }

    // ── Session 操作 ─────────────────────────────────────────
    function handleSessionAction(
        rawInput: string,
        command: Extract<ReturnType<typeof parseTuiCommand>, { type: 'session_action' }>,
    ): void {
        try {
            switch (command.action) {
                case 'list': {
                    const result = buildTuiSessionList(sessionStore, settings.dir, activeSessionId);
                    setRecentSessions(result.sessions);
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    return;
                }
                case 'show': {
                    const result = buildTuiSessionDetail(sessionStore, settings.dir, command.sessionId);
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    return;
                }
                case 'resume': {
                    const result = buildTuiResumeResult(
                        sessionStore,
                        settings.dir,
                        activeSessionId,
                        command.sessionId,
                    );
                    activateSession({
                        sessionId: result.sessionId,
                        title: result.title,
                        info: `Session → ${result.title}`,
                    });
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    return;
                }
            }
        } catch (error) {
            addMessage({ type: 'system', content: `Error: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Share 操作 ───────────────────────────────────────────
    function handleShareAction(
        rawInput: string,
        command: Extract<ReturnType<typeof parseTuiCommand>, { type: 'share_action' }>,
    ): void {
        try {
            switch (command.action) {
                case 'create': {
                    const result = buildTuiShareCreateResult(
                        sessionStore,
                        shareStore,
                        settings.dir,
                        activeSessionId,
                        command.sessionId,
                    );
                    const feedback = buildTuiActionFeedback('share_create', { id: result.share.id });
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    if (feedback.systemMessage) {
                        addMessage({ type: 'system', content: feedback.systemMessage });
                    }
                    setInfoMessage(feedback.infoMessage);
                    return;
                }
                case 'list': {
                    const result = buildTuiShareList(shareStore, settings.dir);
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    return;
                }
                case 'show': {
                    const result = buildTuiShareShow(shareStore, command.shareId ?? '');
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    return;
                }
                case 'remove': {
                    const result = buildTuiShareRemove(shareStore, command.shareId ?? '');
                    const feedback = buildTuiActionFeedback('share_remove', { id: result.share.id });
                    addMessage({ type: 'system', content: result.lines.join('\n') });
                    if (feedback.systemMessage) {
                        addMessage({ type: 'system', content: feedback.systemMessage });
                    }
                    setInfoMessage(feedback.infoMessage);
                    return;
                }
            }
        } catch (error) {
            addMessage({ type: 'system', content: `Error: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Shell 命令（! 前缀）────────────────────────────────
    function handleShell(cmd: string): void {
        if (status === 'running') {
            addMessage({ type: 'system', content: 'Error: command is already running, wait until it finishes.' });
            return;
        }
        addMessage({ type: 'system', content: `$ ${cmd}` });
        setStatus('running');
        setInfoMessage(`$ ${cmd}`);

        runningCommandRef.current = runShellCommand(cmd, settings.dir, {
            onLine: (line) => {
                appendConsoleLog(line);
                addMessage({ type: 'assistant', content: line, isStreaming: true });
            },
            onExit: ({ code, signal }) => {
                runningCommandRef.current = undefined;
                setStatus('idle');
                if (signal) {
                    addMessage({ type: 'system', content: `Stopped (${signal})` });
                } else if (code === 0) {
                    addMessage({ type: 'system', content: 'Completed (exit 0)' });
                } else {
                    addMessage({ type: 'system', content: `Failed (exit ${code ?? 'unknown'})` });
                }
                setInfoMessage('');
            },
        });
    }

    // ── Compact（压缩上下文，Open Code / Claude Code 风格）────────────────
    function handleCompact(): void {
        if (!activeSessionId) {
            addMessage({ type: 'system', content: 'Error: no active session to compact.' });
            return;
        }
        addMessage({ type: 'system', content: 'Compacting session context...' });
        setInfoMessage('Compacting...');
        agentService.compactSession(activeSessionId, {
            dir: settings.dir,
            model: settings.model,
            agent: settings.agent,
            sandboxMode: settings.sandboxMode,
        }).then((summary) => {
            if (summary) {
                const RECENT_DISPLAY_COUNT = 6;
                setMessages(prev => {
                    const keep = prev.slice(-RECENT_DISPLAY_COUNT);
                    const compactBlock: ChatMessage = {
                        id: `compact-${Date.now()}`,
                        type: 'system',
                        content: `Earlier conversation (compressed):\n\n${summary}`,
                    };
                    return [compactBlock, ...keep];
                });
                setInfoMessage('Context compressed');
                refreshRecentSessions(activeSessionId);
            } else {
                addMessage({ type: 'system', content: 'Error: compact failed or too few messages.' });
                setInfoMessage('Compact failed');
            }
        }).catch(() => {
            addMessage({ type: 'system', content: 'Error: compact failed.' });
            setInfoMessage('Compact failed');
        });
    }

    // ── Undo（回滚到最近快照）──────────────────────────────
    function handleUndo(): void {
        try {
            const points = rollbackStore.listPoints(settings.dir, 5);
            if (points.length === 0) {
                addMessage({ type: 'system', content: 'Error: no rollback snapshot in current directory.' });
                return;
            }
            const latest = points[0]!;
            rollbackStore.restorePoint(latest.id);
            const fileList = latest.filePaths.map(f => `  - ${f}`).join('\n');
            addMessage({
                type: 'system',
                content: `Rolled back to snapshot ${latest.id.slice(0, 8)} (${latest.toolName})\n${fileList}`,
            });
            setInfoMessage(`Undo → ${latest.id.slice(0, 8)}`);
        } catch (error) {
            addMessage({ type: 'system', content: `Error: undo failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Copy（复制最后一条 AI 回复到剪贴板）──────────────────
    function handleCopy(): void {
        const lastAssistant = [...messages].reverse().find(m => m.type === 'assistant');
        if (!lastAssistant) {
            setInfoMessage('No AI message to copy');
            return;
        }
        if (copyToClipboard(lastAssistant.content)) {
            const feedback = buildTuiActionFeedback('copy');
            setInfoMessage(feedback.infoMessage);
            if (feedback.systemMessage) {
                addMessage({ type: 'system', content: feedback.systemMessage });
            }
        } else {
            setInfoMessage('Copy failed: clipboard not available');
            addMessage({ type: 'system', content: 'Copy failed: clipboard not available on this platform (need pbcopy/xclip).' });
        }
    }

    function copyToClipboard(text: string): boolean {
        const cmd = process.platform === 'darwin' ? 'pbcopy'
            : (process.env.DISPLAY ? 'xclip' : undefined);
        if (!cmd) return false;
        try {
            spawnSync(cmd, [], { input: text, encoding: 'utf8' });
            return true;
        } catch {
            return false;
        }
    }

    // ── Copy Session（复制完整会话记录到剪贴板）──────────────────
    function handleCopySession(): void {
        if (messages.length === 0) {
            setInfoMessage('No messages to copy');
            return;
        }
        const chatMessages = messages.filter(m => m.type === 'user' || m.type === 'assistant');
        const transcript = chatMessages
            .map(m => `## ${m.type === 'user' ? 'User' : 'Assistant'}\n\n${m.content}`)
            .join('\n\n---\n\n');
        if (copyToClipboard(transcript)) {
            const feedback = buildTuiActionFeedback('copy_session', { count: chatMessages.length });
            setInfoMessage(feedback.infoMessage);
            if (feedback.systemMessage) {
                addMessage({ type: 'system', content: feedback.systemMessage });
            }
        } else {
            setInfoMessage('Copy failed: clipboard not available');
            addMessage({ type: 'system', content: 'Copy failed: clipboard not available on this platform (need pbcopy/xclip).' });
        }
    }

    // ── Copy Code（复制最后一条 AI 回复中的代码块到剪贴板）──────────
    function handleCopyCode(): void {
        const lastAssistant = [...messages].reverse().find(m => m.type === 'assistant');
        if (!lastAssistant) {
            setInfoMessage('No AI message found');
            return;
        }
        const codeBlocks: string[] = [];
        const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = codeBlockRegex.exec(lastAssistant.content)) !== null) {
            codeBlocks.push(match[1]!.trim());
        }
        if (codeBlocks.length === 0) {
            setInfoMessage('No code blocks found in last AI message');
            return;
        }
        const combined = codeBlocks.join('\n\n');
        if (copyToClipboard(combined)) {
            const feedback = buildTuiActionFeedback('copy_code', { count: codeBlocks.length });
            setInfoMessage(feedback.infoMessage);
            if (feedback.systemMessage) {
                addMessage({ type: 'system', content: feedback.systemMessage });
            }
        } else {
            setInfoMessage('Copy failed: clipboard not available');
            addMessage({ type: 'system', content: 'Copy failed: clipboard not available on this platform (need pbcopy/xclip).' });
        }
    }

    // ── Redo（恢复最近一次 undo 操作）──────────────────────────
    function handleRedo(): void {
        try {
            const points = rollbackStore.listPoints(settings.dir, 10);
            if (points.length < 2) {
                addMessage({ type: 'system', content: 'Error: redo unavailable (need at least 2 snapshots).' });
                return;
            }
            const target = points[1]!;
            rollbackStore.restorePoint(target.id);
            const fileList = target.filePaths.map(f => `  - ${f}`).join('\n');
            addMessage({
                type: 'system',
                content: `Redo to snapshot ${target.id.slice(0, 8)} (${target.toolName})\n${fileList}`,
            });
            setInfoMessage(`Redo → ${target.id.slice(0, 8)}`);
        } catch (error) {
            addMessage({ type: 'system', content: `Error: redo failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Details（切换 tool 执行详情显示）────────────────────
    function handleDetails(): void {
        const nextState = toggleToolPanel('tool', getToolPanelState(), timelineEntries);
        applyToolPanelState(nextState);
        setInfoMessage(`Tool details → ${nextState.visiblePanels.includes('tool') ? 'on' : 'off'}`);
    }

    // ── Diff（切换 diff 视图）──────────────────────────────
    function handleDiff(): void {
        const nextState = toggleToolPanel('diff', getToolPanelState(), timelineEntries);
        applyToolPanelState(nextState);
        setInfoMessage(`Diff viewer → ${nextState.visiblePanels.includes('diff') ? 'on' : 'off'}`);
    }

    function handleTimelineToggle(): void {
        const nextState = toggleToolPanel('timeline', getToolPanelState(), timelineEntries);
        applyToolPanelState(nextState);
        setInfoMessage(`Timeline → ${nextState.visiblePanels.includes('timeline') ? 'on' : 'off'}`);
    }

    function handleTimelineNavigation(direction: 'next' | 'prev' | 'toggle'): void {
        const nextState = getNextTimelineState({
            selectedIndex: timelineSelectedIndex,
            expandedIds: timelineExpandedIds,
        }, timelineEntries, direction);
        setTimelineSelectedIndex(nextState.selectedIndex);
        setTimelineExpandedIds(nextState.expandedIds);
        setShellState((current) => ({
            ...current,
            sidePanel: {
                ...current.sidePanel,
                focusedPanel: 'timeline',
            },
        }));
        const selected = timelineEntries[nextState.selectedIndex];
        const synced = syncPanelSelectionFromTimeline(selected, {
            showToolDetails,
            showDiff,
            selectedToolIndex: selectedToolExecutionIndex,
            selectedDiffIndex: diffSelectedIndex,
            expandedToolIds,
        });
        setShellState((current) => ({
            ...current,
            sidePanel: {
                visiblePanels: getVisiblePanels([
                    ...(synced.showToolDetails ? (['tool'] as const) : []),
                    ...(synced.showDiff ? (['diff'] as const) : []),
                    'timeline',
                ]),
                focusedPanel: 'timeline',
            },
        }));
        setSelectedToolExecutionIndex(synced.selectedToolIndex);
        setDiffSelectedIndex(synced.selectedDiffIndex);
        setExpandedToolIds(synced.expandedToolIds);
        if (selected?.kind === 'tool' && typeof selected.sourceIndex === 'number') {
            syncTimelineFromToolSelection(selected.sourceIndex);
        }
        if (selected?.kind === 'file' && typeof selected.sourceIndex === 'number') {
            syncTimelineFromDiffSelection(selected.sourceIndex);
        }
        setInfoMessage(selected ? `Timeline → ${selected.kind}:${selected.title}` : 'Timeline → empty');
    }

    function syncTimelineFromToolSelection(sourceIndex: number): void {
        const nextState = syncTimelineSelectionFromPanel(timelineEntries, {
            selectedIndex: timelineSelectedIndex,
            expandedIds: timelineExpandedIds,
        }, {
            kind: 'tool',
            sourceIndex,
        });
        setTimelineSelectedIndex(nextState.selectedIndex);
        setTimelineExpandedIds(nextState.expandedIds);
        setShellState((current) => ({
            ...current,
            sidePanel: {
                ...current.sidePanel,
                focusedPanel: 'tool',
            },
        }));
    }

    function syncTimelineFromDiffSelection(sourceIndex: number): void {
        const nextState = syncTimelineSelectionFromPanel(timelineEntries, {
            selectedIndex: timelineSelectedIndex,
            expandedIds: timelineExpandedIds,
        }, {
            kind: 'file',
            sourceIndex,
        });
        setTimelineSelectedIndex(nextState.selectedIndex);
        setTimelineExpandedIds(nextState.expandedIds);
        setShellState((current) => ({
            ...current,
            sidePanel: {
                ...current.sidePanel,
                focusedPanel: 'diff',
            },
        }));
    }

    function handleTimelineFocus(panel: ActivePanel): void {
        if (panel === 'tool' && showToolDetails) {
            syncTimelineFromToolSelection(selectedToolExecutionIndex);
            setInfoMessage('Panel focus → tool details');
            return;
        }

        if (panel === 'diff' && showDiff) {
            syncTimelineFromDiffSelection(diffSelectedIndex);
            setInfoMessage('Panel focus → diff');
            return;
        }

        if (!showTimeline) {
            handleTimelineToggle();
            return;
        }

        setShellState((current) => ({
            ...current,
            sidePanel: {
                ...current.sidePanel,
                focusedPanel: 'timeline',
            },
        }));
        const selected = timelineEntries[timelineSelectedIndex];
        setInfoMessage(selected ? `Panel focus → timeline:${selected.title}` : 'Panel focus → timeline');
    }

    function handlePanelNavigation(direction: 'next' | 'prev'): void {
        const panels = getVisiblePanels(visibleSidePanels);

        if (panels.length === 0) {
            return;
        }

        const currentIndex = Math.max(0, panels.indexOf(activePanel));
        const nextIndex = getNextPanelIndex(currentIndex, panels.length, direction);
        const nextPanel = panels[nextIndex] ?? 'timeline';
        handleTimelineFocus(nextPanel);
    }

    // ── Custom Command（自定义命令执行）─────────────────────
    function handleCustomCommand(name: string): void {
        const commands = loadCustomCommands(settings.dir);
        const cmd = commands.find(c => c.name === name);
        if (!cmd) {
            setInfoMessage(`Unknown custom command: ${name}`);
            return;
        }
        if (cmd.variables.length > 0) {
            setInfoMessage(`Custom command "${name}" requires arguments: ${cmd.variables.join(', ')} (use ArgumentsDialog)`);
            return;
        }
        const prompt = executeCustomCommand(cmd, {});
        handleChatMessage(prompt);
    }

    // ── Editor（外部编辑器编辑消息）──────────────────────────
    function handleEditor(): void {
        const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'nano';
        const tmpFile = path.join(os.tmpdir(), `xqoder-editor-${Date.now()}.md`);

        try {
            fs.writeFileSync(tmpFile, editorValue || '', 'utf8');
            const result = spawnSync(editor, [tmpFile], {
                stdio: 'inherit',
                env: process.env,
            });

            if (result.status === 0) {
                const content = fs.readFileSync(tmpFile, 'utf8').trim();
                if (content) {
                    setEditorValue(content);
                    setInfoMessage('Editor content loaded');
                } else {
                    setInfoMessage('Editor: empty content, discarded');
                }
            } else {
                setInfoMessage(`Editor exited with code ${result.status}`);
            }
        } catch (error) {
            addMessage({ type: 'system', content: `Error: editor failed: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }

    // ── Export（导出为 Markdown）──────────────────────────────
    function handleExportMd(): void {
        if (messages.length === 0) {
            addMessage({ type: 'system', content: 'Error: no messages to export.' });
            return;
        }

        const lines: string[] = [
            `# XQoder Session Export`,
            ``,
            `**Date:** ${new Date().toISOString()}`,
            `**Model:** ${settings.model}`,
            `**Agent:** ${settings.agent}`,
            ...(activeSessionId ? [`**Session:** ${activeSessionId}`] : []),
            ``,
            `---`,
            ``,
        ];

        for (const msg of messages) {
            switch (msg.type) {
                case 'user':
                    lines.push(`## User`, ``, msg.content, ``);
                    break;
                case 'assistant':
                    lines.push(`## Assistant`, ``, msg.content, ``);
                    break;
                case 'system':
                    lines.push(`> ${msg.content}`, ``);
                    break;
            }
        }

        const outDir = getXQoderPaths().dataDir;
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const outFile = path.join(outDir, `export-${Date.now()}.md`);

        try {
            fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
            const feedback = buildTuiActionFeedback('export_md', { target: path.basename(outFile) });
            addMessage({ type: 'system', content: `Exported to ${outFile}` });
            if (feedback.systemMessage) {
                addMessage({ type: 'system', content: feedback.systemMessage });
            }
            setInfoMessage(feedback.infoMessage);
        } catch (error) {
            addMessage({ type: 'system', content: `Error: export failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Init（创建/更新项目记忆文件）─────────────────────────
    function handleInit(): void {
        const initPrompt = `Please analyze this codebase and create (or update) an XQoder.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 20 lines long.
If there's already an XQoder.md, improve it.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.`;

        handleChatMessage(initPrompt);
    }

    // ── Thinking（切换 reasoning 块显示）────────────────────
    function handleThinking(): void {
        setShowThinking(prev => {
            setInfoMessage(`Thinking blocks → ${!prev ? 'on' : 'off'}`);
            return !prev;
        });
    }

    // ── Unshare（取消分享）──────────────────────────────────
    function handleUnshare(): void {
        if (!activeSessionId) {
            addMessage({ type: 'system', content: 'Error: no active session to unshare.' });
            return;
        }

        try {
            const shares = shareStore.listShares(settings.dir);
            const sessionShares = shares.filter(s => s.sessionId === activeSessionId);

            if (sessionShares.length === 0) {
                addMessage({ type: 'system', content: 'Error: no share linked to current session.' });
                return;
            }

            let removed = 0;
            for (const share of sessionShares) {
                shareStore.removeShare(share.id);
                removed++;
            }
            const feedback = buildTuiActionFeedback('unshare', { count: removed });
            addMessage({ type: 'system', content: `Removed ${removed} share(s)` });
            if (feedback.systemMessage) {
                addMessage({ type: 'system', content: feedback.systemMessage });
            }
            setInfoMessage(feedback.infoMessage);
        } catch (error) {
            addMessage({ type: 'system', content: `Error: unshare failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    // ── Connect（壳内添加 provider）──────────────────────────
    function handleConnect(): void {
        openDialog('model'); // 暂用 model 面板，后续可加 connect 专用
    }

    // ── 执行命令 ─────────────────────────────────────────────
    function executeCommand(rawInput: string, command: TuiExecutableCommand): void {
        const args = buildCliArgs(command, settings, {
            sessionId: command.command === 'chat' ? activeSessionId : undefined,
        });
        const display = formatCliInvocation(args);

        addMessage({ type: 'system', content: `xqoder ${display}` });
        setStatus('running');
        setActiveCommand(command.command);
        setInfoMessage(`Running: ${command.command}`);

        runningCommandRef.current = runCliCommand(args, settings, {
            onLine: (line) => {
                appendConsoleLog(line);
                addMessage({ type: 'assistant', content: line, isStreaming: true });
            },
            onExit: ({ code, signal }) => {
                runningCommandRef.current = undefined;
                setStatus('idle');
                setActiveCommand(undefined);

                if (signal) {
                    addMessage({ type: 'system', content: `Stopped (${signal})` });
                    setInfoMessage('Command stopped');
                    return;
                }

                if (code === 0) {
                    addMessage({ type: 'system', content: 'Done' });
                    setInfoMessage('Done');
                    if (command.command === 'chat') {
                        refreshRecentSessions(activeSessionId);
                    }
                } else {
                    addMessage({ type: 'system', content: `Failed (exit ${code ?? 'unknown'})` });
                    setInfoMessage('Command failed');
                }
            },
        });
    }

    // ── 工具函数 ─────────────────────────────────────────────
    let msgIdCounter = useRef(0);

    const MAX_MESSAGES = 2000;

    function addMessage(partial: Omit<ChatMessage, 'id' | 'timestamp'>): void {
        msgIdCounter.current++;
        const sanitizedContent = partial.type === 'user'
            ? partial.content
            : sanitizeDisplayText(partial.content);
        const msg: ChatMessage = {
            id: `msg-${msgIdCounter.current}-${Date.now()}`,
            timestamp: new Date(),
            ...partial,
            content: sanitizedContent,
        };
        setMessages(prev => {
            const next = [...prev, msg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
    }

    function appendConsoleLog(line: string): void {
        setConsoleLogs(prev => [...prev, line].slice(-500));
    }

    const handleTranscriptAutoFollowChange = useCallback((autoFollow: boolean): void => {
        const previous = transcriptAutoFollowRef.current;
        transcriptAutoFollowRef.current = autoFollow;
        setTranscriptAutoFollow(autoFollow);

        if (!autoFollow && previous) {
            frozenTranscriptMessagesRef.current = messagesRef.current;
        }

        if (!previous && autoFollow) {
            frozenTranscriptMessagesRef.current = null;
        }
    }, []);

    const handleTranscriptSelectionCopied = useCallback((success: boolean): void => {
        if (success) {
            setInfoMessage('Copied selected transcript text');
            return;
        }

        setInfoMessage('Copy failed: clipboard not available');
    }, []);

    function showChatPage(): void {
        setShellState((current) => ({
            ...current,
            page: 'chat',
        }));
    }

    function toggleLogsPage(): void {
        setShellState((current) => ({
            ...current,
            page: togglePage(current.page),
        }));
    }

    function refreshRecentSessions(preferredId?: string): void {
        try {
            const result = buildTuiSessionList(
                sessionStore,
                settings.dir,
                preferredId ?? activeSessionId,
            );
            setRecentSessions(result.sessions);

            const next = result.sessions.find(s => s.id === (preferredId ?? activeSessionId))
                ?? result.sessions[0];
            setActiveSessionId(next?.id);
            setActiveSessionTitle(next?.title);
        } catch {
            setRecentSessions([]);
        }
    }

    function activateSession(params: {
        sessionId: string;
        title?: string;
        info: string;
    }): void {
        showChatPage();
        setActiveSessionId(params.sessionId);
        setActiveSessionTitle(params.title);
        refreshRecentSessions(params.sessionId);
        setInfoMessage(params.info);
    }

    useEffect(() => {
        if (!activeSessionId) {
            frozenTranscriptMessagesRef.current = null;
            transcriptAutoFollowRef.current = true;
            setTranscriptAutoFollow(true);
            setMessages([]);
            return;
        }

        try {
            const session = sessionStore.getSession(activeSessionId);
            frozenTranscriptMessagesRef.current = null;
            transcriptAutoFollowRef.current = true;
            setTranscriptAutoFollow(true);
            setMessages(session ? restoreChatMessagesFromSession(session.getMessages()) : []);
        } catch {
            frozenTranscriptMessagesRef.current = null;
            transcriptAutoFollowRef.current = true;
            setTranscriptAutoFollow(true);
            setMessages([]);
        }
    }, [activeSessionId, sessionStore]);

    function resumeSession(sessionSelector?: string): void {
        const result = buildTuiResumeResult(
            sessionStore,
            settings.dir,
            activeSessionId,
            sessionSelector,
        );

        activateSession({
            sessionId: result.sessionId,
            title: result.title,
            info: `Session → ${result.title}`,
        });
    }

    function createSession(): void {
        const summary = sessionStore.createEmptySession(
            settings.dir,
            settings.model,
        );

        activateSession({
            sessionId: summary.id,
            title: summary.title,
            info: 'New session created',
        });
    }

    // ── Session 信息转换 ──────────────────────────────────────
    const sessionInfos: SessionInfo[] = recentSessions.map(s => ({
        id: s.id,
        title: s.title,
        updatedAt: new Date(s.updatedAt ?? Date.now()),
        messageCount: s.messageCount ?? 0,
        isActive: s.id === activeSessionId,
    }));

    // ── 当前 session usage ────────────────────────────────────
    const activeUsage: SessionUsage | undefined = recentSessions
        .find(s => s.id === activeSessionId)?.usage;

    // ── 命令面板命令列表 ──────────────────────────────────────
    const commandPaletteEntries = [
        { id: 'help', label: 'Show Help', shortcut: 'Ctrl+?', action: () => openDialog('help') },
        { id: 'theme', label: 'Switch Theme', shortcut: 'Ctrl+T', action: () => openDialog('theme') },
        { id: 'session', label: 'Switch Session', shortcut: 'Ctrl+S', action: () => openDialog('session') },
        { id: 'newSession', label: 'New Session', shortcut: 'Ctrl+N', action: () => createSession() },
        { id: 'model', label: 'Select Model', shortcut: 'Ctrl+O', action: () => openDialog('model') },
        { id: 'file-picker', label: 'Pick File', shortcut: 'Ctrl+F', action: () => openDialog('filePicker') },
        { id: 'logs', label: 'Toggle Logs Page', shortcut: 'Ctrl+L', action: toggleLogsPage },
        { id: 'mouse-terminal', label: 'Mouse: terminal', shortcut: 'Ctrl+G', action: () => updateMouseMode('terminal') },
        { id: 'mouse-app', label: 'Mouse: app', shortcut: 'Ctrl+G', action: () => updateMouseMode('app') },
        { id: 'agent-general', label: 'Agent: general', shortcut: 'Ctrl+A', action: () => { setSettings(s => ({ ...s, agent: 'general' })); setInfoMessage('Agent → general'); } },
        { id: 'agent-plan', label: 'Agent: plan', shortcut: 'Ctrl+A', action: () => { setSettings(s => ({ ...s, agent: 'plan' })); setInfoMessage('Agent → plan'); } },
        { id: 'agent-coder', label: 'Agent: coder', shortcut: 'Ctrl+A', action: () => { setSettings(s => ({ ...s, agent: 'coder' })); setInfoMessage('Agent → coder'); } },
        { id: 'quit', label: 'Quit', shortcut: 'Ctrl+C', action: () => requestExit() },
        { id: 'clear', label: 'Clear Messages', action: () => { setMessages([]); setConsoleLogs([]); } },
    ];

    // ── 日志条目 ─────────────────────────────────────────────
    const logEntries: LogEntry[] = logsFromStrings(consoleLogs);

    // ── 渲染 ─────────────────────────────────────────────────
    return (
        <Box width={dims.width} height={dims.height} flexDirection="column">
            {/* ── 主页面 ── */}
            {page === 'chat' && (
                <ChatPage
                    width={dims.width}
                    height={dims.height}
                    messages={displayedMessages}
                    editorValue={editorValue}
                    onEditorChange={setEditorValue}
                    onEditorSubmit={handleEditorSubmit}
                    sessions={sessionInfos}
                    currentSessionId={activeSessionId}
                    onSelectSession={(id) => {
                        try {
                            resumeSession(id);
                        } catch {
                            // ignore
                        }
                    }}
                    onNewSession={createSession}
                    model={settings.model}
                    agent={settings.agent}
                    usage={activeUsage}
                    cwd={settings.dir}
                    slashCommands={getSlashCommands(settings)}
                    infoMessage={infoMessage}
                    mouseMode={mouseMode}
                    mouseScrollStep={mouseScrollStep}
                    onTranscriptAutoFollowChange={handleTranscriptAutoFollowChange}
                    onTranscriptSelectionCopied={handleTranscriptSelectionCopied}
                    editorAttachments={editorAttachments}
                    onRemoveAttachment={removeEditorAttachment}
                    onClearAttachments={clearEditorAttachments}
                    isDialogOpen={anyDialogOpen}
                    toolExecutions={toolExecutions}
                    visibleSidePanels={visibleSidePanels}
                    selectedToolExecutionIndex={selectedToolExecutionIndex}
                    expandedToolIds={expandedToolIds}
                    fileChanges={fileChanges}
                    diffSelectedIndex={diffSelectedIndex}
                    timelineEntries={timelineEntries}
                    timelineExpandedIds={timelineExpandedIds}
                    timelineSelectedIndex={timelineSelectedIndex}
                    focusedSidePanel={activePanel}
                    activeCommand={activeCommand}
                    contextWindow={getContextWindow(settings.model)}
                    sessionCost={activeUsage?.cost ?? 0}
                />
            )}

            {page === 'logs' && (
                <LogsPage
                    logs={logEntries}
                    width={dims.width}
                    height={dims.height}
                    isActive={!anyDialogOpen}
                />
            )}

            {/* ── 对话框（渲染在最后，视觉覆盖主内容）── */}

            {activeOverlay === 'help' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={64}>
                    <HelpDialog
                        width={64}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'theme' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={50}>
                    <ThemeDialog
                        width={50}
                        onClose={closeAllDialogs}
                        onThemeChange={(name) => {
                            setTheme(name);
                            configManager.setThemeSetting(name);
                            setInfoMessage(`Theme → ${name}`);
                        }}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'session' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={60}>
                    <SessionSelectorDialog
                        sessions={sessionInfos}
                        width={60}
                        currentSessionId={activeSessionId}
                        onSelect={(id) => {
                            try {
                                resumeSession(id);
                            } catch {
                                // ignore
                            }
                        }}
                        onNew={createSession}
                        onDelete={(id) => {
                            try {
                                sessionStore.deleteSession(id);
                                if (id === activeSessionId) {
                                    setActiveSessionId(undefined);
                                    setActiveSessionTitle(undefined);
                                }
                                refreshRecentSessions();
                                setInfoMessage('Session deleted');
                            } catch {
                                // ignore
                            }
                        }}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'model' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={60}>
                    <ModelSelectorDialog
                        width={60}
                        currentModel={settings.model}
                        onSelect={(model) => {
                            setSettings(s => ({ ...s, model }));
                            configManager.updateDefaultModel(model);
                            setInfoMessage(`Model → ${model} (saved)`);
                        }}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'permission' && permissionRequest && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={60}>
                    <PermissionDialog
                        request={permissionRequest}
                        width={60}
                        onAllowOnce={() => {
                            pendingPermissionApproval.current?.resolve(true);
                            pendingPermissionApproval.current = null;
                            closeAllDialogs();
                        }}
                        onAllowAlways={() => {
                            allowAllPermissions.current = true;
                            setSettings(prev => ({ ...prev, sandboxMode: 'full-access' }));
                            pendingPermissionApproval.current?.resolve(true);
                            pendingPermissionApproval.current = null;
                            setInfoMessage('Permissions: allow all (full access)');
                            closeAllDialogs();
                        }}
                        onDeny={() => {
                            pendingPermissionApproval.current?.resolve(false);
                            pendingPermissionApproval.current = null;
                            closeAllDialogs();
                        }}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'question' && questionRequest && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={72}>
                    <QuestionDialog
                        request={questionRequest}
                        width={72}
                        onSubmit={(answer) => {
                            pendingQuestionAnswer.current?.resolve(answer);
                            pendingQuestionAnswer.current = null;
                            setQuestionRequest(null);
                            closeAllDialogs();
                        }}
                        onCancel={() => {
                            pendingQuestionAnswer.current?.resolve({
                                requestId: questionRequest.requestId,
                                selected: questionRequest.options.length > 0 ? [questionRequest.options[0]!.label] : [],
                            });
                            pendingQuestionAnswer.current = null;
                            setQuestionRequest(null);
                            closeAllDialogs();
                        }}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'commandPalette' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={60}>
                    <CommandPalette
                        commands={commandPaletteEntries}
                        width={60}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'filePicker' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={64}>
                    <FilePicker
                        cwd={settings.dir}
                        width={64}
                        height={20}
                        onSelect={(filePath) => {
                            addEditorAttachment(filePath, 'file');
                            closeAllDialogs();
                        }}
                        onCancel={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'init' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={60}>
                    <InitDialog
                        width={60}
                        projectDir={settings.dir}
                        onInitialize={() => {
                            closeAllDialogs();
                            handleInit();
                        }}
                        onSkip={closeAllDialogs}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}

            {activeOverlay === 'contextCompletion' && (
                <DialogOverlay appWidth={dims.width} appHeight={dims.height} dialogWidth={64}>
                    <ContextCompletionDialog
                        width={64}
                        cwd={settings.dir}
                        onSelect={(item: ContextItem) => {
                            addEditorAttachment(item.path, 'context');
                            closeAllDialogs();
                        }}
                        onClose={closeAllDialogs}
                    />
                </DialogOverlay>
            )}
        </Box>
    );
}

// ── React Error Boundary — prevents render crashes from killing the process ──

interface ErrorBoundaryState {
    hasError: boolean;
    errorMessage: string;
}

class TuiErrorBoundary extends React.Component<
    { children: React.ReactNode },
    ErrorBoundaryState
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, errorMessage: '' };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, errorMessage: error.message };
    }

    componentDidCatch(error: Error, _info: ErrorInfo): void {
        try {
            process.stderr.write(`[XQoder] Render error: ${error.message}\n`);
        } catch { /* stderr broken */ }
    }

    render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <Box flexDirection="column" padding={1}>
                    <Text color="red" bold>XQoder encountered a rendering error:</Text>
                    <Text color="yellow">{this.state.errorMessage}</Text>
                    <Text color="gray">Press Ctrl+C to exit, or the app will try to recover.</Text>
                </Box>
            );
        }
        return this.props.children;
    }
}

export function XQoderTuiSafe(props: XQoderTuiProps): React.JSX.Element {
    return (
        <TuiErrorBoundary>
            <XQoderTui {...props} />
        </TuiErrorBoundary>
    );
}
