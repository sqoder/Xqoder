import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TuiAgentSettings } from '../tui/agent-service.js';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { TerminalEventLoop } from '../terminal-core/event-loop.js';
import { reduceTerminalAppState } from './reducer.js';
import { tryHandleEditorCommand } from './editor-command-runner.js';
import {
    createRuntimeSessionResolveStoreAdapter,
    listResolvedSessionSummaries,
} from '../services/session-resolve.js';

vi.mock('../services/session-resolve.js', () => ({
    createRuntimeSessionResolveStoreAdapter: vi.fn(() => ({})),
    listResolvedSessionSummaries: vi.fn(),
    resolveSessionById: vi.fn(),
    resolveSessionForExport: vi.fn(),
    resolveSessionForTui: vi.fn(),
}));

const tempDirs: string[] = [];

function createEventLoop() {
    return new TerminalEventLoop({
        initialState: createInitialTerminalAppState({ width: 100, height: 30 }, { cwd: '/repo' }),
        reduce: reduceTerminalAppState,
        render: () => {},
    });
}

function createSettings(): TuiAgentSettings {
    return {
        dir: '/repo',
        model: 'gpt-4o',
        agent: 'general',
        sandboxMode: 'full-access',
    };
}

function createDeps(overrides: Partial<Parameters<typeof tryHandleEditorCommand>[3]> = {}) {
    let activeSessionId: string | undefined = 'session-1';
    return {
        deps: {
            sessionStore: {} as any,
            agentService: {} as any,
            settings: createSettings(),
            getActiveSessionId: () => activeSessionId,
            setActiveSessionId: (id: string | undefined) => {
                activeSessionId = id;
            },
            getInterruptManager: () => null,
            maxTerminalAttachments: 5,
            formatAttachmentLabel: (resolvedPath: string) => path.basename(resolvedPath),
            inferAttachmentKind: () => 'file' as const,
            ...overrides,
        },
        getActiveSessionId: () => activeSessionId,
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    vi.clearAllMocks();
});

describe('editor command runner', () => {
    it('attaches an existing local file and resets the editor', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-editor-command-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'notes.txt');
        fs.writeFileSync(filePath, 'hello', 'utf8');

        const eventLoop = createEventLoop();
        eventLoop.dispatch({ type: 'editor.set-value', value: '/attach notes.txt' });
        const { deps } = createDeps();

        const handled = tryHandleEditorCommand('/attach notes.txt', dir, eventLoop, deps);

        expect(handled).toBe(true);
        expect(eventLoop.getState().editor.attachments).toHaveLength(1);
        expect(eventLoop.getState().editor.attachments[0]?.path).toBe(filePath);
        expect(eventLoop.getState().notice).toBe('Attached notes.txt');
        expect(eventLoop.getState().editor.value).toBe('');
    });

    it('creates a new local session while preserving the draft input', () => {
        const eventLoop = createEventLoop();
        eventLoop.dispatch({ type: 'editor.set-value', value: 'draft prompt', cursorOffset: 'draft prompt'.length });
        const { deps, getActiveSessionId } = createDeps();

        const handled = tryHandleEditorCommand('/new', '/repo', eventLoop, deps);

        expect(handled).toBe(true);
        expect(getActiveSessionId()).toBeUndefined();
        expect(eventLoop.getState().activeSessionId).toBeUndefined();
        expect(eventLoop.getState().editor.value).toBe('draft prompt');
        expect(eventLoop.getState().notice).toBe('new session');
    });

    it('opens the session overlay through the extracted async command effect', async () => {
        vi.mocked(createRuntimeSessionResolveStoreAdapter).mockReturnValue({} as any);
        vi.mocked(listResolvedSessionSummaries).mockResolvedValue([
            {
                id: 'session-alpha',
                title: 'Alpha Session',
                projectRoot: '/repo',
                cwd: '/repo',
                model: 'gpt-4o',
                createdAt: new Date('2026-03-24T00:00:00.000Z'),
                updatedAt: new Date('2026-03-24T00:00:00.000Z'),
                maxMessages: 100,
                messageCount: 1,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            },
        ]);

        const eventLoop = createEventLoop();
        const { deps } = createDeps();

        const handled = tryHandleEditorCommand('/sessions', '/repo', eventLoop, deps);
        await Promise.resolve();
        await Promise.resolve();

        expect(handled).toBe(true);
        expect(vi.mocked(listResolvedSessionSummaries)).toHaveBeenCalledOnce();
        const overlay = eventLoop.getState().overlay;
        expect(overlay?.type).toBe('session');
        if (!overlay || overlay.type !== 'session') {
            throw new Error('expected session overlay');
        }
        expect(overlay.items[0]).toEqual({
            id: 'session-alpha',
            title: 'Alpha Session',
        });
    });
});
