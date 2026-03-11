/**
 * App handlers - extracted from app.tsx for better organization.
 * Contains session, share, and command handlers.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { TuiSettings } from './commands.js';
import type { TuiExecutableCommand } from './commands.js';
import { buildCliArgs, formatCliInvocation, parseTuiCommand } from './commands.js';
import { runCliCommand, runShellCommand, type RunningCliCommand } from './runner.js';
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
import type { FileRollbackStore } from '@xqoder/agent';
import type { SQLiteSessionStore, PersistedSessionSummary } from '@xqoder/storage-sqlite';
import type { FileSessionShareStore } from '../session-assets.js';
import type { TuiAgentService } from './agent-service.js';
import { getXQoderPaths } from '@xqoder/shared';
import { copyToClipboard, sanitizeDisplayText } from './agent-event-processor.js';

export interface HandlerContext {
    settings: TuiSettings;
    sessionStore: SQLiteSessionStore;
    shareStore: FileSessionShareStore;
    rollbackStore: FileRollbackStore;
    agentService: TuiAgentService;
    activeSessionId?: string;
    messages: Array<{ type: string; content: string }>;
    status: 'idle' | 'running';
    showToolDetails: boolean;
}

export interface HandlerDeps {
    setSettings: React.Dispatch<React.SetStateAction<TuiSettings>>;
    setActiveSessionId: React.Dispatch<React.SetStateAction<string | undefined>>;
    setActiveSessionTitle: React.Dispatch<React.SetStateAction<string | undefined>>;
    setInfoMessage: React.Dispatch<React.SetStateAction<string>>;
    setStatus: React.Dispatch<React.SetStateAction<'idle' | 'running'>>;
    addMessage: (msg: { type: string; content: string }) => void;
    appendConsoleLog: (line: string) => void;
    refreshRecentSessions: (preferredId?: string) => void;
    showChatPage: () => void;
    handleChatMessage: (text: string) => void;
    openDialog: (key: string) => void;
    toggleToolPanel: (panel: string, state: Record<string, unknown>, entries: unknown[]) => Record<string, unknown>;
    timelineEntries: unknown[];
    toolPanelState: Record<string, unknown>;
    setShowToolDetails: React.Dispatch<React.SetStateAction<boolean>>;
    setShowDiff: React.Dispatch<React.SetStateAction<boolean>>;
    setShowTimeline: React.Dispatch<React.SetStateAction<boolean>>;
    setActivePanel: React.Dispatch<React.SetStateAction<string>>;
    setTimelineSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
    setTimelineExpandedIds: React.Dispatch<React.SetStateAction<string[]>>;
    setEditorValue: React.Dispatch<React.SetStateAction<string>>;
    setShowThinking: React.Dispatch<React.SetStateAction<boolean>>;
    runningCommandRef: React.MutableRefObject<RunningCliCommand | undefined>;
}

export type AddMessageFn = (msg: { type: 'user' | 'assistant' | 'system'; content: string }) => void;

export function handleSessionList(
    sessionStore: SQLiteSessionStore,
    dir: string,
    activeSessionId: string | undefined,
    addMessage: AddMessageFn,
    setRecentSessions: (sessions: PersistedSessionSummary[]) => void,
): void {
    const result = buildTuiSessionList(sessionStore, dir, activeSessionId);
    setRecentSessions(result.sessions);
    addMessage({ type: 'system', content: result.lines.join('\n') });
}

export function handleSessionShow(
    sessionStore: SQLiteSessionStore,
    dir: string,
    sessionId: string,
    addMessage: AddMessageFn,
): void {
    const result = buildTuiSessionDetail(sessionStore, dir, sessionId);
    addMessage({ type: 'system', content: result.lines.join('\n') });
}

export interface SessionResumeResult {
    sessionId: string;
    title: string;
    lines: string[];
}

export function handleSessionResume(
    sessionStore: SQLiteSessionStore,
    dir: string,
    activeSessionId: string | undefined,
    sessionId: string,
): SessionResumeResult {
    return buildTuiResumeResult(sessionStore, dir, activeSessionId, sessionId);
}

export function handleShareCreate(
    sessionStore: SQLiteSessionStore,
    shareStore: FileSessionShareStore,
    dir: string,
    activeSessionId: string | undefined,
    sessionId: string | undefined,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    const result = buildTuiShareCreateResult(sessionStore, shareStore, dir, activeSessionId, sessionId);
    const feedback = buildTuiActionFeedback('share_create', { id: result.share.id });
    addMessage({ type: 'system', content: result.lines.join('\n') });
    if (feedback.systemMessage) {
        addMessage({ type: 'system', content: feedback.systemMessage });
    }
    setInfoMessage(feedback.infoMessage);
}

export function handleShareList(
    shareStore: FileSessionShareStore,
    dir: string,
    addMessage: AddMessageFn,
): void {
    const result = buildTuiShareList(shareStore, dir);
    addMessage({ type: 'system', content: result.lines.join('\n') });
}

export function handleShareShow(
    shareStore: FileSessionShareStore,
    shareId: string,
    addMessage: AddMessageFn,
): void {
    const result = buildTuiShareShow(shareStore, shareId);
    addMessage({ type: 'system', content: result.lines.join('\n') });
}

export function handleShareRemove(
    shareStore: FileSessionShareStore,
    shareId: string,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    const result = buildTuiShareRemove(shareStore, shareId);
    const feedback = buildTuiActionFeedback('share_remove', { id: result.share.id });
    addMessage({ type: 'system', content: result.lines.join('\n') });
    if (feedback.systemMessage) {
        addMessage({ type: 'system', content: feedback.systemMessage });
    }
    setInfoMessage(feedback.infoMessage);
}

export function handleShellCommand(
    cmd: string,
    dir: string,
    status: 'idle' | 'running',
    addMessage: AddMessageFn,
    setStatus: (status: 'idle' | 'running') => void,
    setInfoMessage: (msg: string) => void,
    appendConsoleLog: (line: string) => void,
    runningCommandRef: React.MutableRefObject<RunningCliCommand | undefined>,
): void {
    if (status === 'running') {
        addMessage({ type: 'system', content: 'Error: command is already running, wait until it finishes.' });
        return;
    }
    addMessage({ type: 'system', content: `$ ${cmd}` });
    setStatus('running');
    setInfoMessage(`$ ${cmd}`);

    runningCommandRef.current = runShellCommand(cmd, dir, {
        onLine: (line) => {
            appendConsoleLog(line);
            addMessage({ type: 'assistant', content: line, isStreaming: true } as never);
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

export interface CompactResult {
    summary: string | null;
    error?: string;
}

export async function handleCompact(
    activeSessionId: string | undefined,
    agentService: TuiAgentService,
    settings: TuiSettings,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
    refreshRecentSessions: (id?: string) => void,
    setMessages: React.Dispatch<React.SetStateAction<Array<{ id: string; type: string; content: string }>>>,
): Promise<CompactResult> {
    if (!activeSessionId) {
        addMessage({ type: 'system', content: 'Error: no active session to compact.' });
        return { summary: null, error: 'no session' };
    }

    addMessage({ type: 'system', content: 'Compacting session context...' });
    setInfoMessage('Compacting...');

    try {
        const summary = await agentService.compactSession(activeSessionId, {
            dir: settings.dir,
            model: settings.model,
            agent: settings.agent,
            sandboxMode: settings.sandboxMode,
        });

        if (summary) {
            const RECENT_DISPLAY_COUNT = 6;
            setMessages(prev => {
                const keep = prev.slice(-RECENT_DISPLAY_COUNT);
                const compactBlock = {
                    id: `compact-${Date.now()}`,
                    type: 'system',
                    content: `Earlier conversation (compressed):\n\n${summary}`,
                    timestamp: new Date(),
                };
                return [compactBlock, ...keep];
            });
            setInfoMessage('Context compressed');
            refreshRecentSessions(activeSessionId);
            return { summary };
        } else {
            addMessage({ type: 'system', content: 'Error: compact failed or too few messages.' });
            setInfoMessage('Compact failed');
            return { summary: null, error: 'failed' };
        }
    } catch {
        addMessage({ type: 'system', content: 'Error: compact failed.' });
        setInfoMessage('Compact failed');
        return { summary: null, error: 'failed' };
    }
}

export function handleUndo(
    rollbackStore: FileRollbackStore,
    dir: string,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    try {
        const points = rollbackStore.listPoints(dir, 5);
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

export function handleRedo(
    rollbackStore: FileRollbackStore,
    dir: string,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    try {
        const points = rollbackStore.listPoints(dir, 10);
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

export { copyToClipboard };

export function handleCopy(
    messages: Array<{ type: string; content: string }>,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
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

export function handleCopySession(
    messages: Array<{ type: string; content: string }>,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    const chatMessages = messages.filter(m => m.type === 'user' || m.type === 'assistant');
    if (chatMessages.length === 0) {
        setInfoMessage('No messages to copy');
        return;
    }
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

export function handleCopyCode(
    messages: Array<{ type: string; content: string }>,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
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

export function handleExportMd(
    messages: Array<{ type: string; content: string }>,
    settings: TuiSettings,
    activeSessionId: string | undefined,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
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

export function handleEditor(
    editorValue: string,
    setEditorValue: (value: string) => void,
    setInfoMessage: (msg: string) => void,
    addMessage: AddMessageFn,
): void {
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

export function handleUnshare(
    activeSessionId: string | undefined,
    shareStore: FileSessionShareStore,
    dir: string,
    addMessage: AddMessageFn,
    setInfoMessage: (msg: string) => void,
): void {
    if (!activeSessionId) {
        addMessage({ type: 'system', content: 'Error: no active session to unshare.' });
        return;
    }

    try {
        const shares = shareStore.listShares(dir);
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

export const INIT_PROMPT = `Please analyze this codebase and create (or update) an XQoder.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 20 lines long.
If there's already an XQoder.md, improve it.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.`;
