import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPendingRequest, dispatchAgentMessage } from './submit-dispatcher.js';

const mocked = vi.hoisted(() => ({
    getQuestionFallbackSelection: vi.fn(() => ['fallback']),
}));

vi.mock('../terminal-core/interaction-protocol.js', () => ({
    getQuestionFallbackSelection: mocked.getQuestionFallbackSelection,
}));

describe('submit-dispatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('blocks write tools in plan mode', async () => {
        let hooks: any;
        const sendMessage = vi.fn((_prompt, _session, _settings, _attachments, incomingHooks) => {
            hooks = incomingHooks;
            return Promise.resolve({ sessionId: 's2' });
        });
        const dispatch = vi.fn();

        dispatchAgentMessage({
            eventLoop: { dispatch },
            bridge: { onProtocolEvent: vi.fn() } as any,
            agentService: { sendMessage } as any,
            getActiveSessionId: () => 's1',
            setActiveSessionId: vi.fn(),
            isAutoApproveToolsForSession: () => false,
            getPendingApprovalResolve: () => null,
            setPendingApprovalResolve: vi.fn(),
            getPendingQuestionResolve: () => null,
            setPendingQuestionResolve: vi.fn(),
        }, 'prompt', { dir: '/repo', model: 'm', agent: 'general', sandboxMode: 'full-access' }, [], 'plan');

        const approved = await hooks.onToolApproval({ toolName: 'write_file' });
        expect(approved).toBe(false);
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Plan mode blocked write/exec tool: write_file' });
    });

    it('captures approval resolver when tool is allowed', async () => {
        let hooks: any;
        const sendMessage = vi.fn((_prompt, _session, _settings, _attachments, incomingHooks) => {
            hooks = incomingHooks;
            return Promise.resolve({ sessionId: 's2' });
        });
        const setPendingApprovalResolve = vi.fn();

        dispatchAgentMessage({
            eventLoop: { dispatch: vi.fn() },
            bridge: { onProtocolEvent: vi.fn() } as any,
            agentService: { sendMessage } as any,
            getActiveSessionId: () => 's1',
            setActiveSessionId: vi.fn(),
            isAutoApproveToolsForSession: () => false,
            getPendingApprovalResolve: () => null,
            setPendingApprovalResolve,
            getPendingQuestionResolve: () => null,
            setPendingQuestionResolve: vi.fn(),
        }, 'prompt', { dir: '/repo', model: 'm', agent: 'general', sandboxMode: 'full-access' }, [], 'plan');

        const promise = hooks.onToolApproval({ toolName: 'read_file' });
        expect(setPendingApprovalResolve).toHaveBeenCalledTimes(1);
        expect(promise).toBeInstanceOf(Promise);
    });

    it('cancels pending request and resolves fallback question', async () => {
        const approvalResolve = vi.fn();
        const questionResolve = vi.fn();
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const cancel = vi.fn();

        await cancelPendingRequest({
            eventLoop: { getState: () => ({ pendingQuestion: { requestId: 'q1' } }), dispatch, renderNow },
            bridge: { onProtocolEvent: vi.fn() } as any,
            agentService: { cancel } as any,
            getActiveSessionId: () => 's1',
            setActiveSessionId: vi.fn(),
            isAutoApproveToolsForSession: () => false,
            getPendingApprovalResolve: () => approvalResolve,
            setPendingApprovalResolve: vi.fn(),
            getPendingQuestionResolve: () => questionResolve,
            setPendingQuestionResolve: vi.fn(),
        });

        expect(approvalResolve).toHaveBeenCalledWith(false);
        expect(questionResolve).toHaveBeenCalledWith({ requestId: 'q1', selected: ['fallback'] });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Cancelled current request' });
        expect(renderNow).toHaveBeenCalledTimes(1);
    });
});
