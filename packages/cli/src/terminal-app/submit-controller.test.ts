import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubmitController } from './submit-controller.js';

const mocked = vi.hoisted(() => ({
    expandEditorValueForSubmit: vi.fn(() => 'hello world'),
    buildSubmitPayload: vi.fn(async () => ({ promptText: 'resolved prompt', attachments: [] })),
    dispatchAgentMessage: vi.fn(),
    dispatchInitMessage: vi.fn(),
    cancelPendingRequest: vi.fn(async () => undefined),
}));

vi.mock('../terminal-core/editor-model.js', () => ({
    expandEditorValueForSubmit: mocked.expandEditorValueForSubmit,
}));

vi.mock('./submit-context-resolver.js', () => ({
    buildSubmitPayload: mocked.buildSubmitPayload,
}));

vi.mock('./submit-dispatcher.js', () => ({
    dispatchAgentMessage: mocked.dispatchAgentMessage,
    dispatchInitMessage: mocked.dispatchInitMessage,
    cancelPendingRequest: mocked.cancelPendingRequest,
}));

describe('createSubmitController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function baseDeps() {
        const eventLoop = {
            getState: () => ({
                runtimeStatus: 'idle',
                pendingApproval: null,
                pendingQuestion: null,
                editor: { attachments: [] },
                model: 'm1',
                interactionMode: 'build',
            }),
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
        };
        return {
            eventLoop,
            bridge: { onProtocolEvent: vi.fn() } as any,
            agentService: {} as any,
            sessionStore: null,
            getSettings: () => ({ dir: '/repo', model: 'm0', agent: 'general', sandboxMode: 'full-access' }),
            getActiveSessionId: () => 's1',
            setActiveSessionId: vi.fn(),
            isAutoApproveToolsForSession: () => false,
            getPendingApprovalResolve: () => null,
            setPendingApprovalResolve: vi.fn(),
            getPendingQuestionResolve: () => null,
            setPendingQuestionResolve: vi.fn(),
            maxTerminalAttachments: 5,
            formatAttachmentLabel: (p: string) => p,
            inferAttachmentKind: () => 'file' as const,
            tryHandleEditorCommand: () => false,
        };
    }

    async function flushAsyncBranch(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
    }

    it('dispatches submit flow with payload from resolver', async () => {
        const deps = baseDeps();
        const controller = createSubmitController(deps as any);

        await controller.submitEditor();

        expect(mocked.buildSubmitPayload).toHaveBeenCalledTimes(1);
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith({ type: 'editor.reset' });
        expect(mocked.dispatchAgentMessage).toHaveBeenCalledTimes(1);
    });

    it('returns early when runtime is busy', async () => {
        const deps = baseDeps();
        deps.eventLoop.getState = () => ({
            runtimeStatus: 'thinking',
            pendingApproval: null,
            pendingQuestion: null,
            editor: { attachments: [] },
            model: 'm1',
            interactionMode: 'build',
        });
        const controller = createSubmitController(deps as any);

        await controller.submitEditor();

        expect(mocked.buildSubmitPayload).not.toHaveBeenCalled();
        expect(mocked.dispatchAgentMessage).not.toHaveBeenCalled();
    });

    it('handles attach mode /session list', async () => {
        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session list');
        const deps = baseDeps();
        const listSessions = vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]);
        deps.agentService = { listSessions } as any;
        const controller = createSubmitController({ ...deps, attachBaseUrl: 'http://localhost:8080' } as any);

        await controller.submitEditor();
        await flushAsyncBranch();

        expect(listSessions).toHaveBeenCalledWith('/repo', 20);
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice.set' }));
        expect(mocked.buildSubmitPayload).not.toHaveBeenCalled();
    });

    it('handles attach mode /session new and switch', async () => {
        const deps = baseDeps();
        const createSession = vi.fn(async () => ({ id: 's-new', title: 'new title' }));
        const getSessionMessages = vi.fn(async () => ({ messages: [{ role: 'assistant', content: 'hi' }] }));
        deps.agentService = { createSession, getSessionMessages } as any;
        const setActiveSessionId = vi.fn();
        deps.setActiveSessionId = setActiveSessionId;
        const controller = createSubmitController({ ...deps, attachBaseUrl: 'http://localhost:8080' } as any);

        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session new');
        await controller.submitEditor();
        await flushAsyncBranch();
        expect(createSession).toHaveBeenCalledWith('/repo');
        expect(setActiveSessionId).toHaveBeenCalledWith('s-new');
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.restored', sessionId: 's-new' }));

        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session switch target-1');
        await controller.submitEditor();
        await flushAsyncBranch();
        expect(getSessionMessages).toHaveBeenCalledWith('target-1');
        expect(setActiveSessionId).toHaveBeenCalledWith('target-1');
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.restored', sessionId: 'target-1' }));
    });

    it('shows usage notice for /session and /session switch without id', async () => {
        const deps = baseDeps();
        deps.agentService = {
            listSessions: vi.fn(async () => []),
            createSession: vi.fn(async () => ({ id: 's-new', title: 'new title' })),
            getSessionMessages: vi.fn(async () => ({ messages: [] })),
        } as any;
        const controller = createSubmitController({ ...deps, attachBaseUrl: 'http://localhost:8080' } as any);

        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session');
        await controller.submitEditor();
        await flushAsyncBranch();
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Usage: /session list | new | switch <id>' });

        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session switch');
        await controller.submitEditor();
        await flushAsyncBranch();
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Usage: /session list | new | switch <id>' });
    });

    it('handles remote errors in attach mode', async () => {
        mocked.expandEditorValueForSubmit.mockReturnValueOnce('/session list');
        const deps = baseDeps();
        const listSessions = vi.fn(async () => {
            throw new Error('remote boom');
        });
        deps.agentService = { listSessions } as any;
        const controller = createSubmitController({ ...deps, attachBaseUrl: 'http://localhost:8080' } as any);

        await controller.submitEditor();
        await flushAsyncBranch();

        expect(listSessions).toHaveBeenCalledTimes(1);
        expect(deps.eventLoop.dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'remote boom' });
    });

    it('supports continue submit after interrupt-like busy state clears', async () => {
        const deps = baseDeps();
        let runtimeStatus: 'thinking' | 'idle' = 'thinking';
        deps.eventLoop.getState = () => ({
            runtimeStatus,
            pendingApproval: null,
            pendingQuestion: null,
            editor: { attachments: [] },
            model: 'm1',
            interactionMode: 'build',
        });
        const controller = createSubmitController(deps as any);

        await controller.submitEditor();
        expect(mocked.buildSubmitPayload).not.toHaveBeenCalled();

        runtimeStatus = 'idle';
        await controller.submitEditor();
        expect(mocked.buildSubmitPayload).toHaveBeenCalledTimes(1);
        expect(mocked.dispatchAgentMessage).toHaveBeenCalledTimes(1);
    });
});
