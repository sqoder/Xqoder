import * as fs from 'node:fs';
import * as path from 'node:path';
import { getXQoderPaths } from '@xqoder/shared';
import { AgentSession } from '@xqoder/agent';
import type { TerminalAppState } from '../terminal-core/app-state.js';
import type { TerminalEventLoop } from '../terminal-core/event-loop.js';
import {
    resolveSessionForExport,
} from '../services/session-resolve.js';
import { renderSessionMarkdown } from '../session-assets.js';
import { TuiAgentService, type LocalTuiSessionStore, type RemoteTuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import type { InterruptManager } from './interrupt-manager.js';
import {
    createLocalSessionResolveStore,
    listLocalResolvedSessions,
    resolveLocalSession,
} from './session-runner.js';

type EditorCommandEventLoop = Pick<TerminalEventLoop<TerminalAppState>, 'dispatch' | 'getState'>;

export interface EditorCommandRunnerDeps {
    sessionStore: LocalTuiSessionStore | null;
    agentService: TuiAgentService | RemoteTuiAgentService;
    attachBaseUrl?: string;
    settings: TuiAgentSettings;
    getActiveSessionId: () => string | undefined;
    setActiveSessionId: (id: string | undefined) => void;
    getInterruptManager: () => InterruptManager | null;
    maxTerminalAttachments: number;
    formatAttachmentLabel: (resolvedPath: string) => string;
    inferAttachmentKind: (resolvedPath: string) => 'file' | 'image' | 'text';
}

function setNotice(eventLoop: EditorCommandEventLoop, notice: string): void {
    eventLoop.dispatch({ type: 'notice.set', notice });
}

function resetEditor(eventLoop: EditorCommandEventLoop): void {
    eventLoop.dispatch({ type: 'editor.reset' });
}

export function tryHandleEditorCommand(
    prompt: string,
    cwd: string,
    eventLoop: EditorCommandEventLoop,
    deps: EditorCommandRunnerDeps,
): boolean {
    const trimmed = prompt.trim();
    if (!trimmed.startsWith('/')) {
        return false;
    }

    const [command, ...rest] = trimmed.split(/\s+/);
    if (command === '/attach') {
        const rawPath = rest.join(' ').trim();
        if (!rawPath) {
            setNotice(eventLoop, 'Usage: /attach <path>');
            resetEditor(eventLoop);
            return true;
        }

        const resolvedPath = path.resolve(cwd, rawPath);
        if (!fs.existsSync(resolvedPath)) {
            setNotice(eventLoop, `Attachment missing: ${resolvedPath}`);
            resetEditor(eventLoop);
            return true;
        }

        const current = eventLoop.getState().editor.attachments;
        if (current.some((attachment) => attachment.path === resolvedPath)) {
            setNotice(eventLoop, `Attachment already added: ${path.basename(resolvedPath)}`);
            resetEditor(eventLoop);
            return true;
        }

        if (current.length >= deps.maxTerminalAttachments) {
            setNotice(eventLoop, `Attachment limit reached (${deps.maxTerminalAttachments})`);
            resetEditor(eventLoop);
            return true;
        }

        eventLoop.dispatch({
            type: 'editor.append-attachment',
            attachment: {
                id: resolvedPath,
                label: deps.formatAttachmentLabel(resolvedPath),
                kind: deps.inferAttachmentKind(resolvedPath),
                path: resolvedPath,
            },
        });
        setNotice(eventLoop, `Attached ${path.basename(resolvedPath)}`);
        resetEditor(eventLoop);
        return true;
    }

    if (command === '/detach') {
        eventLoop.dispatch({ type: 'editor.remove-last-attachment' });
        setNotice(eventLoop, 'Removed last attachment');
        resetEditor(eventLoop);
        return true;
    }

    if (command === '/attachments' && rest[0] === 'clear') {
        eventLoop.dispatch({ type: 'editor.clear-attachments' });
        setNotice(eventLoop, 'Cleared attachments');
        resetEditor(eventLoop);
        return true;
    }

    if (command === '/new') {
        if (deps.attachBaseUrl) {
            setNotice(eventLoop, 'Remote mode: /new not supported');
            return true;
        }
        const currentInput = eventLoop.getState().editor.value;
        deps.setActiveSessionId(undefined);
        resetEditor(eventLoop);
        eventLoop.dispatch({ type: 'session.new' });
        eventLoop.dispatch({
            type: 'editor.set-value',
            value: currentInput,
            cursorOffset: currentInput.length,
        });
        setNotice(eventLoop, 'new session');
        return true;
    }

    if (command === '/sessions') {
        if (deps.attachBaseUrl || !deps.sessionStore) {
            setNotice(eventLoop, 'Remote mode: /sessions not supported');
            return true;
        }
        const sessionStore = deps.sessionStore;
        void (async () => {
            try {
                const sessions = await listLocalResolvedSessions(
                    sessionStore,
                    deps.settings.dir,
                    deps.settings,
                    20,
                );
                eventLoop.dispatch({
                    type: 'overlay.open',
                    kind: 'session',
                    items: sessions.map((session) => ({ id: session.id, title: session.title ?? session.id })),
                });
            } catch (err) {
                setNotice(eventLoop, err instanceof Error ? err.message : String(err));
            }
        })();
        return true;
    }

    if (command === '/export') {
        if (deps.attachBaseUrl || !deps.sessionStore) {
            setNotice(eventLoop, 'Remote mode: /export not supported');
            return true;
        }

        void (async () => {
            try {
                const argName = rest.join(' ').trim();
                const { session, summary } = await resolveSessionForExport(
                    createLocalSessionResolveStore(deps.sessionStore!, deps.settings),
                    deps.getActiveSessionId(),
                    deps.settings.dir,
                );

                const outDir = path.join(getXQoderPaths().dataDir, 'exports');
                const outPath = (argName && path.isAbsolute(argName))
                    ? (argName.endsWith('.md') ? argName : `${argName}.md`)
                    : (() => {
                        const safeBase = (argName || `${summary.title ?? 'session'}_${summary.id}_${Date.now()}`)
                            .replace(/[\\/]/g, '_')
                            .replace(/\s+/g, ' ')
                            .trim();
                        const fileName = safeBase.endsWith('.md') ? safeBase : `${safeBase}.md`;
                        return path.join(outDir, fileName);
                    })();

                const markdown = renderSessionMarkdown(summary, session);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, markdown, 'utf-8');

                setNotice(eventLoop, `已导出到 ${outPath}`);
            } catch (err) {
                setNotice(eventLoop, err instanceof Error ? err.message : String(err));
            }
        })();

        return true;
    }

    if (command === '/compact') {
        if (deps.attachBaseUrl || !deps.sessionStore) {
            setNotice(eventLoop, 'Remote mode: /compact not supported');
            return true;
        }
        const sessionStore = deps.sessionStore;

        void (async () => {
            setNotice(eventLoop, 'compacting...');
            try {
                const sessionId = deps.getActiveSessionId();
                if (!sessionId) {
                    setNotice(eventLoop, 'No active session to compact');
                    return;
                }

                const compactFn = (deps.agentService as {
                    compactSession?: (id: string, settings: TuiAgentSettings) => Promise<string | null>;
                }).compactSession;
                if (typeof compactFn !== 'function') {
                    setNotice(eventLoop, 'Compact not available in current agent service');
                    return;
                }

                const summaryText = await compactFn(sessionId, deps.settings);
                if (!summaryText) {
                    setNotice(eventLoop, 'compaction skipped');
                    return;
                }

                const resolved = await resolveLocalSession(sessionStore, deps.settings, sessionId);
                if (!resolved) {
                    setNotice(eventLoop, 'compaction done but failed to reload session');
                    return;
                }

                eventLoop.dispatch({
                    type: 'session.restored',
                    sessionId,
                    title: resolved.summary.title,
                    cwd: resolved.summary.cwd,
                    messages: resolved.session.getMessages(),
                });
                setNotice(eventLoop, 'compacted');
            } catch (err) {
                setNotice(eventLoop, err instanceof Error ? err.message : String(err));
            }
        })();

        return true;
    }

    if (command === '/undo') {
        if (deps.attachBaseUrl || !deps.sessionStore) {
            setNotice(eventLoop, 'Remote mode: /undo not supported');
            return true;
        }

        void (async () => {
            const sessionStore = deps.sessionStore;
            const waitForIdle = async (maxWaitMs: number): Promise<void> => {
                const started = Date.now();
                while (Date.now() - started < maxWaitMs) {
                    const status = eventLoop.getState().runtimeStatus;
                    const running = status === 'thinking' || status === 'running-tool' || status === 'awaiting-approval';
                    if (!running) {
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 40));
                }
            };

            setNotice(eventLoop, 'undoing...');
            try {
                const interrupt = deps.getInterruptManager();
                const status = eventLoop.getState().runtimeStatus;
                if (status === 'thinking' || status === 'running-tool' || status === 'awaiting-approval') {
                    interrupt?.onCtrlCKey();
                    await waitForIdle(6000);
                }

                const sessionId = deps.getActiveSessionId();
                if (!sessionId) {
                    setNotice(eventLoop, 'No active session to undo');
                    return;
                }

                if (!sessionStore) {
                    setNotice(eventLoop, 'Session store not available');
                    return;
                }

                const resolved = await resolveLocalSession(sessionStore, deps.settings, sessionId);
                if (!resolved) {
                    setNotice(eventLoop, 'Session not found');
                    return;
                }
                const session = resolved.session;
                const sessionSummary = resolved.summary;

                const messages = session.getMessages();
                let lastUserIdx = -1;
                for (let i = messages.length - 1; i >= 0; i -= 1) {
                    if (messages[i]!.role === 'user') {
                        lastUserIdx = i;
                        break;
                    }
                }

                if (lastUserIdx < 0) {
                    setNotice(eventLoop, 'No user message to undo');
                    return;
                }

                const revertedText = String(messages[lastUserIdx]?.content ?? '');
                const trimmedMessages = messages.slice(0, lastUserIdx);

                const snapshot = session.toSnapshot();
                snapshot.messages = trimmedMessages;
                const nextSession = AgentSession.fromSnapshot(snapshot);

                if (deps.agentService instanceof TuiAgentService) {
                    await deps.agentService.replaceSessionMessages({
                        sessionId,
                        cwd: sessionSummary.cwd,
                        projectRoot: sessionSummary.projectRoot,
                        model: sessionSummary.model,
                        title: sessionSummary.title,
                        messages: trimmedMessages,
                    });
                } else {
                    sessionStore.saveSessionSnapshot({
                        session: nextSession as any,
                        projectRoot: sessionSummary.projectRoot,
                        cwd: sessionSummary.cwd,
                        model: sessionSummary.model,
                        title: sessionSummary.title,
                    });
                }

                eventLoop.dispatch({
                    type: 'session.restored',
                    sessionId,
                    title: sessionSummary.title,
                    cwd: sessionSummary.cwd,
                    messages: nextSession.getMessages(),
                });
                eventLoop.dispatch({
                    type: 'editor.set-value',
                    value: revertedText,
                    cursorOffset: revertedText.length,
                });

                setNotice(eventLoop, '已撤销最后一条消息');
            } catch (err) {
                setNotice(eventLoop, err instanceof Error ? err.message : String(err));
            }
        })();

        return true;
    }

    return false;
}
