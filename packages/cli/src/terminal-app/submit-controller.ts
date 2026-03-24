import { expandEditorValueForSubmit } from '../terminal-core/editor-model.js';
import type { ProtocolRuntimeBridge } from '../terminal-core/runtime-bridge.js';
import { RemoteTuiAgentService, type LocalTuiSessionStore, type TuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import { buildSubmitPayload } from './submit-context-resolver.js';
import { cancelPendingRequest, dispatchAgentMessage, dispatchInitMessage } from './submit-dispatcher.js';

const INIT_PROMPT = `Please analyze this codebase and create (or update) an XQoder.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 20 lines long.
If there's already an XQoder.md, improve it.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.`;

type QuestionResolve = (answer: { requestId: string; selected: string[]; customText?: string }) => void;

interface SubmitControllerDeps {
    eventLoop: any;
    bridge: ProtocolRuntimeBridge;
    agentService: TuiAgentService | RemoteTuiAgentService;
    sessionStore: LocalTuiSessionStore | null;
    attachBaseUrl?: string;
    getSettings: () => TuiAgentSettings;
    getActiveSessionId: () => string | undefined;
    setActiveSessionId: (sessionId: string | undefined) => void;
    isAutoApproveToolsForSession: () => boolean;
    getPendingApprovalResolve: () => ((approved: boolean) => void) | null;
    setPendingApprovalResolve: (resolve: ((approved: boolean) => void) | null) => void;
    getPendingQuestionResolve: () => QuestionResolve | null;
    setPendingQuestionResolve: (resolve: QuestionResolve | null) => void;
    maxTerminalAttachments: number;
    formatAttachmentLabel: (filePath: string) => string;
    inferAttachmentKind: (filePath: string) => 'file' | 'image' | 'text';
    tryHandleEditorCommand: (prompt: string) => boolean;
}

export function createSubmitController(deps: SubmitControllerDeps): {
    submitEditor: () => Promise<void>;
    submitInitPrompt: () => void;
    cancelCurrentLLMRequest: () => Promise<void>;
} {
    const submitEditor = async (): Promise<void> => {
        const state = deps.eventLoop.getState();
        const settings = deps.getSettings();
        const prompt = expandEditorValueForSubmit(state.editor).trim();
        if (!prompt || state.runtimeStatus === 'thinking' || state.runtimeStatus === 'running-tool' || state.pendingApproval || state.pendingQuestion) {
            return;
        }

        if (deps.tryHandleEditorCommand(prompt)) {
            await deps.eventLoop.renderNow();
            return;
        }

        if (deps.attachBaseUrl && (prompt === '/session' || prompt.startsWith('/session '))) {
            const remote = deps.agentService as RemoteTuiAgentService;
            const parts = prompt.split(/\s+/);
            const sub = parts[1];
            deps.eventLoop.dispatch({ type: 'editor.reset' });
            await deps.eventLoop.renderNow();
            void (async () => {
                try {
                    if (sub === 'list') {
                        const list = await remote.listSessions(settings.dir, 20);
                        const notice = list.length === 0
                            ? 'No sessions. Use /session new to create one.'
                            : `Sessions (${list.length}): ${list.slice(0, 5).map((item) => item.id).join(', ')}${list.length > 5 ? '…' : ''} — /session switch <id>`;
                        deps.eventLoop.dispatch({ type: 'notice.set', notice });
                    } else if (sub === 'new') {
                        const created = await remote.createSession(settings.dir);
                        deps.setActiveSessionId(created.id);
                        deps.eventLoop.dispatch({ type: 'session.restored', sessionId: created.id, title: created.title, messages: [] });
                        deps.eventLoop.dispatch({ type: 'notice.set', notice: `New session: ${created.id}` });
                    } else if (sub === 'switch' && parts[2]) {
                        const id = parts[2].trim();
                        const data = await remote.getSessionMessages(id);
                        deps.setActiveSessionId(id);
                        deps.eventLoop.dispatch({ type: 'session.restored', sessionId: id, messages: data.messages });
                    } else {
                        deps.eventLoop.dispatch({ type: 'notice.set', notice: 'Usage: /session list | new | switch <id>' });
                    }
                } catch (err) {
                    deps.eventLoop.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                }
                await deps.eventLoop.renderNow();
            })();
            return;
        }

        const payload = await buildSubmitPayload(prompt, state, {
            eventLoop: deps.eventLoop,
            sessionStore: deps.sessionStore,
            attachBaseUrl: deps.attachBaseUrl,
            agentService: deps.agentService,
            getSettings: deps.getSettings,
            getActiveSessionId: deps.getActiveSessionId,
            maxTerminalAttachments: deps.maxTerminalAttachments,
            formatAttachmentLabel: deps.formatAttachmentLabel,
            inferAttachmentKind: deps.inferAttachmentKind,
        });

        deps.eventLoop.dispatch({ type: 'editor.reset' });
        dispatchAgentMessage({
            eventLoop: deps.eventLoop,
            bridge: deps.bridge,
            agentService: deps.agentService,
            getActiveSessionId: deps.getActiveSessionId,
            setActiveSessionId: deps.setActiveSessionId,
            isAutoApproveToolsForSession: deps.isAutoApproveToolsForSession,
            getPendingApprovalResolve: deps.getPendingApprovalResolve,
            setPendingApprovalResolve: deps.setPendingApprovalResolve,
            getPendingQuestionResolve: deps.getPendingQuestionResolve,
            setPendingQuestionResolve: deps.setPendingQuestionResolve,
        }, payload.promptText, { ...settings, model: state.model ?? settings.model }, payload.attachments, state.interactionMode);
    };

    const submitInitPrompt = (): void => {
        const state = deps.eventLoop.getState();
        if (state.runtimeStatus !== 'idle' && state.runtimeStatus !== 'done' && state.runtimeStatus !== 'error') {
            return;
        }
        const settings = deps.getSettings();
        dispatchInitMessage({
            eventLoop: deps.eventLoop,
            bridge: deps.bridge,
            agentService: deps.agentService,
            getActiveSessionId: deps.getActiveSessionId,
            setActiveSessionId: deps.setActiveSessionId,
            isAutoApproveToolsForSession: deps.isAutoApproveToolsForSession,
            getPendingApprovalResolve: deps.getPendingApprovalResolve,
            setPendingApprovalResolve: deps.setPendingApprovalResolve,
            getPendingQuestionResolve: deps.getPendingQuestionResolve,
            setPendingQuestionResolve: deps.setPendingQuestionResolve,
        }, INIT_PROMPT, { ...settings, model: state.model ?? settings.model });
    };

    const cancelCurrentLLMRequest = async (): Promise<void> => {
        await cancelPendingRequest({
            eventLoop: deps.eventLoop,
            bridge: deps.bridge,
            agentService: deps.agentService,
            getActiveSessionId: deps.getActiveSessionId,
            setActiveSessionId: deps.setActiveSessionId,
            isAutoApproveToolsForSession: deps.isAutoApproveToolsForSession,
            getPendingApprovalResolve: deps.getPendingApprovalResolve,
            setPendingApprovalResolve: deps.setPendingApprovalResolve,
            getPendingQuestionResolve: deps.getPendingQuestionResolve,
            setPendingQuestionResolve: deps.setPendingQuestionResolve,
        });
    };

    return {
        submitEditor,
        submitInitPrompt,
        cancelCurrentLLMRequest,
    };
}
