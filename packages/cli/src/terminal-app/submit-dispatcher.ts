import { getQuestionFallbackSelection } from '../terminal-core/interaction-protocol.js';
import type { ProtocolRuntimeBridge } from '../terminal-core/runtime-bridge.js';
import { RemoteTuiAgentService, type TuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';
import type { MessageAttachment } from '@xqoder/shared';

type QuestionResolve = (answer: { requestId: string; selected: string[]; customText?: string }) => void;

interface SubmitDispatcherDeps {
    eventLoop: any;
    bridge: ProtocolRuntimeBridge;
    agentService: TuiAgentService | RemoteTuiAgentService;
    getActiveSessionId: () => string | undefined;
    setActiveSessionId: (sessionId: string | undefined) => void;
    isAutoApproveToolsForSession: () => boolean;
    getPendingApprovalResolve: () => ((approved: boolean) => void) | null;
    setPendingApprovalResolve: (resolve: ((approved: boolean) => void) | null) => void;
    getPendingQuestionResolve: () => QuestionResolve | null;
    setPendingQuestionResolve: (resolve: QuestionResolve | null) => void;
}

const PLAN_ALLOWED_TOOLS = new Set([
    'read_file', 'grep_content', 'search_code', 'glob_files', 'list_files', 'fetch_url',
    'websearch', 'diagnostics', 'sourcegraph', 'skill', 'question', 'todoread',
]);

export function dispatchAgentMessage(
    deps: SubmitDispatcherDeps,
    promptText: string,
    sendSettings: TuiAgentSettings,
    attachments: MessageAttachment[],
    submitMode: 'build' | 'plan',
): void {
    void deps.agentService.sendMessage(promptText, deps.getActiveSessionId(), sendSettings, attachments, {
        onEvent: (event) => {
            deps.bridge.onProtocolEvent(event);
        },
        onToolApproval: async (request) => {
            if (submitMode === 'plan' && !PLAN_ALLOWED_TOOLS.has(request.toolName) && !request.toolName.startsWith('lsp_')) {
                deps.eventLoop.dispatch({ type: 'notice.set', notice: `Plan mode blocked write/exec tool: ${request.toolName}` });
                return false;
            }
            if (deps.isAutoApproveToolsForSession()) {
                return true;
            }
            return new Promise<boolean>((resolve) => {
                deps.setPendingApprovalResolve(resolve);
            });
        },
        onQuestion: async () => new Promise<{ requestId: string; selected: string[]; customText?: string }>((resolve) => {
            deps.setPendingQuestionResolve(resolve);
        }),
    }).then((result) => {
        deps.setActiveSessionId(result.sessionId);
        deps.eventLoop.dispatch({ type: 'session.attached', sessionId: result.sessionId });
        deps.eventLoop.dispatch({ type: 'notice.set', notice: 'Message sent' });
    }).catch((error) => {
        deps.bridge.onProtocolEvent({
            type: 'error',
            sessionId: deps.getActiveSessionId() ?? 'terminal-preview',
            timestamp: Date.now(),
            source: 'runtime',
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
        });
    });
}

export function dispatchInitMessage(
    deps: SubmitDispatcherDeps,
    promptText: string,
    sendSettings: TuiAgentSettings,
): void {
    void deps.agentService.sendMessage(promptText, deps.getActiveSessionId(), sendSettings, [], {
        onEvent: (event) => { deps.bridge.onProtocolEvent(event); },
        onToolApproval: async () => {
            if (deps.isAutoApproveToolsForSession()) {
                return true;
            }
            return new Promise<boolean>((resolve) => { deps.setPendingApprovalResolve(resolve); });
        },
        onQuestion: async () => new Promise<{ requestId: string; selected: string[]; customText?: string }>((resolve) => {
            deps.setPendingQuestionResolve(resolve);
        }),
    }).then((result) => {
        deps.setActiveSessionId(result.sessionId);
        deps.eventLoop.dispatch({ type: 'session.attached', sessionId: result.sessionId });
        deps.eventLoop.dispatch({ type: 'notice.set', notice: 'Init sent — creating XQoder.md' });
    }).catch((error) => {
        deps.bridge.onProtocolEvent({
            type: 'error',
            sessionId: deps.getActiveSessionId() ?? 'terminal-preview',
            timestamp: Date.now(),
            source: 'runtime',
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
        });
    });
}

export async function cancelPendingRequest(deps: SubmitDispatcherDeps): Promise<void> {
    deps.getPendingApprovalResolve()?.(false);
    deps.setPendingApprovalResolve(null);
    const pendingQuestion = deps.eventLoop.getState().pendingQuestion;
    if (pendingQuestion) {
        deps.getPendingQuestionResolve()?.({
            requestId: pendingQuestion.requestId,
            selected: getQuestionFallbackSelection(pendingQuestion),
        });
        deps.setPendingQuestionResolve(null);
    }
    if ('cancel' in deps.agentService && typeof deps.agentService.cancel === 'function') {
        deps.agentService.cancel();
    }
    deps.eventLoop.dispatch({ type: 'notice.set', notice: 'Cancelled current request' });
    await deps.eventLoop.renderNow();
}
