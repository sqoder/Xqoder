import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSubmitPayload } from './submit-context-resolver.js';

const mocked = vi.hoisted(() => ({
    extractAttachmentReferencesFromPrompt: vi.fn(() => ({ text: 'hello', attachmentPaths: [] as string[] })),
    mergeAttachmentPaths: vi.fn((existing: string[], incoming: string[]) => ({ paths: [...existing, ...incoming] })),
    extractContextReferencesFromPrompt: vi.fn(() => ({
        text: 'hello',
        sessionReferences: [{ target: 'current' }],
        symbolReferences: [{ query: 'Foo' }],
    })),
    scanSymbolMatches: vi.fn(() => [{ path: '/repo/src/a.ts', line: 10, content: 'class Foo {}' }]),
}));

vi.mock('../attachment-references.js', () => ({
    extractAttachmentReferencesFromPrompt: mocked.extractAttachmentReferencesFromPrompt,
    mergeAttachmentPaths: mocked.mergeAttachmentPaths,
}));

vi.mock('../context-references.js', () => ({
    extractContextReferencesFromPrompt: mocked.extractContextReferencesFromPrompt,
    scanSymbolMatches: mocked.scanSymbolMatches,
}));

describe('buildSubmitPayload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds prompt with @session and @symbol context blocks', async () => {
        const dispatch = vi.fn();
        const payload = await buildSubmitPayload('hello', {
            interactionMode: 'build',
            editor: { attachments: [] },
            cwd: '/repo',
        }, {
            eventLoop: { getState: () => ({ cwd: '/repo' }), dispatch },
            sessionStore: {
                getSessionSnapshot: () => ({
                    id: 's1',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    maxMessages: 100,
                    messages: [{ role: 'assistant', content: 'done' }],
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    metadata: { compactions: [], toolHistory: [], commandHistory: [], fileChanges: [] },
                }),
                getSessionSummary: () => ({ id: 's1', title: 'Session 1', updatedAt: new Date('2026-01-01T00:00:00Z') }),
                listSessions: () => [{ id: 's1' }],
            } as any,
            attachBaseUrl: undefined,
            agentService: {} as any,
            getSettings: () => ({ dir: '/repo', model: 'm', agent: 'general', sandboxMode: 'full-access' }),
            getActiveSessionId: () => 's1',
            maxTerminalAttachments: 5,
            formatAttachmentLabel: (p) => p,
            inferAttachmentKind: () => 'file',
        });

        expect(payload.promptText).toContain('[SessionContext]');
        expect(payload.promptText).toContain('sessionId: s1');
        expect(payload.promptText).toContain('[SymbolContext]');
        expect(payload.promptText).toContain('query: Foo');
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'notice.set' }));
    });

    it('emits notice when @symbol has no matches', async () => {
        mocked.scanSymbolMatches.mockReturnValueOnce([]);
        const dispatch = vi.fn();
        const payload = await buildSubmitPayload('hello', {
            interactionMode: 'plan',
            editor: { attachments: [] },
            cwd: '/repo',
        }, {
            eventLoop: { getState: () => ({ cwd: '/repo' }), dispatch },
            sessionStore: {
                getSessionSnapshot: () => ({
                    id: 's1',
                    createdAt: new Date('2026-01-01T00:00:00Z'),
                    maxMessages: 100,
                    messages: [{ role: 'assistant', content: 'done' }],
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    metadata: { compactions: [], toolHistory: [], commandHistory: [], fileChanges: [] },
                }),
                getSessionSummary: () => ({ id: 's1', title: 'Session 1', updatedAt: new Date('2026-01-01T00:00:00Z') }),
                listSessions: () => [{ id: 's1' }],
            } as any,
            attachBaseUrl: undefined,
            agentService: {} as any,
            getSettings: () => ({ dir: '/repo', model: 'm', agent: 'general', sandboxMode: 'full-access' }),
            getActiveSessionId: () => 's1',
            maxTerminalAttachments: 5,
            formatAttachmentLabel: (p) => p,
            inferAttachmentKind: () => 'file',
        });

        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'No symbols found for @symbol:Foo' });
        expect(payload.promptText).toContain('[Mode: PLAN]');
        expect(payload.promptText).not.toContain('[SymbolContext]');
    });
});
