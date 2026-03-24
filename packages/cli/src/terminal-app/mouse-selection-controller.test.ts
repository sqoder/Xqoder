import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { MouseSelectionController } from './mouse-selection-controller.js';

const mocked = vi.hoisted(() => ({
    queryMessageViewport: vi.fn(() => ({ scrollOffset: 0, isFollowingBottom: false })),
    handleMouseEvent: vi.fn(() => false),
    computeLayout: vi.fn(),
    hitTest: vi.fn(),
    findEntryIndex: vi.fn(() => -1),
    isFoldedDiffMarker: vi.fn(() => false),
    writeText: vi.fn(async () => undefined),
    writeToClipboardOSC52: vi.fn(),
    copyTarget: vi.fn(async () => true),
}));

vi.mock('../terminal-core/clipboard.js', () => ({
    getClipboardService: () => ({
        writeText: mocked.writeText,
        readText: vi.fn(async () => ''),
    }),
    writeToClipboardOSC52: mocked.writeToClipboardOSC52,
}));

vi.mock('../terminal-core/copy-action.js', async () => {
    const actual = await vi.importActual<typeof import('../terminal-core/copy-action.js')>('../terminal-core/copy-action.js');
    return {
        ...actual,
        copyTarget: mocked.copyTarget,
    };
});

vi.mock('../terminal-core/rust-tui.js', () => ({
    rustTui: {
        queryMessageViewport: mocked.queryMessageViewport,
        handleMouseEvent: mocked.handleMouseEvent,
        computeLayout: mocked.computeLayout,
        hitTest: mocked.hitTest,
        findEntryIndex: mocked.findEntryIndex,
        isFoldedDiffMarker: mocked.isFoldedDiffMarker,
    },
}));

function createTestState() {
    const state = createInitialTerminalAppState({ width: 120, height: 30 });
    return {
        ...state,
        page: 'chat' as const,
        overlay: null,
        overlayStack: [],
        diffExpandedBlockIds: [],
        transcriptLines: Array.from({ length: 128 }, (_, index) => `line-${index}`),
        transcriptCodeBlocks: [],
        transcriptEntryLineRanges: [],
        transcriptEntryLineStarts: [],
        transcriptEntryLineEnds: [],
        viewport: {
            ...state.viewport,
            scrollOffset: 0,
            selectedRange: null,
        },
    };
}

describe('MouseSelectionController overlay drag lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.queryMessageViewport.mockReset();
        mocked.queryMessageViewport.mockReturnValue({ scrollOffset: 0, isFollowingBottom: false });
        mocked.handleMouseEvent.mockReset();
        mocked.handleMouseEvent.mockReturnValue(false);
        mocked.computeLayout.mockReset();
        mocked.hitTest.mockReset();
        mocked.findEntryIndex.mockReset();
        mocked.findEntryIndex.mockReturnValue(-1);
        mocked.isFoldedDiffMarker.mockReset();
        mocked.isFoldedDiffMarker.mockReturnValue(false);
        mocked.writeText.mockReset();
        mocked.writeText.mockResolvedValue(undefined);
        mocked.writeToClipboardOSC52.mockReset();
        mocked.copyTarget.mockReset();
        mocked.copyTarget.mockResolvedValue(true);
    });

    it('does not inherit stale anchor across overlay open/release/close drag sequence', () => {
        const layout = {
            header: { x: 0, y: 0, width: 120, height: 1 },
            messages: { x: 0, y: 1, width: 80, height: 20 },
            messagesScrollbar: { x: 80, y: 1, width: 1, height: 20 },
            input: { x: 0, y: 22, width: 80, height: 6 },
            footer: { x: 0, y: 28, width: 120, height: 1 },
            sidebar: { x: 81, y: 1, width: 39, height: 20 },
            hasSidebar: true,
        };
        mocked.computeLayout.mockImplementation(() => layout as any);
        mocked.hitTest
            .mockReturnValueOnce({ kind: 'message', line_offset: 10 }) // first press
            .mockReturnValueOnce({ kind: 'message', line_offset: 12 }) // first drag
            .mockReturnValueOnce({ kind: 'message', line_offset: 30 }) // second press
            .mockReturnValueOnce({ kind: 'message', line_offset: 33 }); // second drag

        const dispatch = vi.fn();
        const controller = new MouseSelectionController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const baseState = createTestState();

        // 1) 按下 + 拖拽（建立 anchor）
        expect(controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 12,
            y: 12,
            raw: '',
        }, baseState)).toBe(true);
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 12,
            y: 14,
            raw: '',
        }, baseState)).toBe(true);

        // 2) overlay 打开（run-terminal-app-core 在 st.overlay 分支会显式 clear anchor）
        controller.clearSelectionAnchor();

        // 3) overlay 期间 release（事件不应继承旧 anchor）
        controller.clearSelectionAnchor();

        // 4) overlay 关闭后直接 drag（没有新的 press，不应产生 selection 更新）
        const selectionCountBeforeNoAnchorDrag = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set').length;
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 12,
            y: 16,
            raw: '',
        }, {
            ...baseState,
            overlay: null,
        })).toBe(false);
        const selectionCountAfterNoAnchorDrag = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set').length;
        expect(selectionCountAfterNoAnchorDrag).toBe(selectionCountBeforeNoAnchorDrag);

        // 5) 再次按下 + 拖拽（应使用新的 anchor）
        expect(controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 12,
            y: 22,
            raw: '',
        }, baseState)).toBe(true);
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 12,
            y: 25,
            raw: '',
        }, baseState)).toBe(true);

        const selectionEvents = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set');
        expect(selectionEvents.at(-1)).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 30, column: 11 },
                end: { line: 33, column: 11 },
            },
        });
    });

    it('ignores overlay wheel/drag noise after anchor is cleared by the run loop', () => {
        const layout = {
            header: { x: 0, y: 0, width: 120, height: 1 },
            messages: { x: 0, y: 1, width: 80, height: 20 },
            messagesScrollbar: { x: 80, y: 1, width: 1, height: 20 },
            input: { x: 0, y: 22, width: 80, height: 6 },
            footer: { x: 0, y: 28, width: 120, height: 1 },
            sidebar: { x: 81, y: 1, width: 39, height: 20 },
            hasSidebar: true,
        };
        mocked.computeLayout.mockImplementation(() => layout as any);
        mocked.hitTest
            .mockReturnValueOnce({ kind: 'message', line_offset: 15 }) // initial press
            .mockReturnValueOnce({ kind: 'message', line_offset: 17 }) // initial drag
            .mockReturnValueOnce({ kind: 'message', line_offset: 40 }) // final press
            .mockReturnValueOnce({ kind: 'message', line_offset: 43 }); // final drag

        const dispatch = vi.fn();
        const controller = new MouseSelectionController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const baseState = createTestState();

        expect(controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 14,
            y: 17,
            raw: '',
        }, baseState)).toBe(true);
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 14,
            y: 19,
            raw: '',
        }, baseState)).toBe(true);

        // Simulate run-terminal-app-core overlay branch: every overlay input frame clears anchor
        // before overlay controllers handle wheel/drag/release noise.
        const noiseInputs = [
            { type: 'mouse' as const, kind: 'scroll' as const, direction: 'up' as const, x: 16, y: 11, raw: '' },
            { type: 'mouse' as const, kind: 'drag' as const, button: 'left' as const, x: 16, y: 12, raw: '' },
            { type: 'mouse' as const, kind: 'release' as const, button: 'left' as const, x: 16, y: 12, raw: '' },
            { type: 'mouse' as const, kind: 'scroll' as const, direction: 'down' as const, x: 18, y: 13, raw: '' },
            { type: 'mouse' as const, kind: 'drag' as const, button: 'left' as const, x: 18, y: 14, raw: '' },
        ];

        const selectionCountBeforeNoise = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set').length;
        for (const input of noiseInputs) {
            controller.clearSelectionAnchor();
            controller.handle(input as any, {
                ...baseState,
                overlay: { type: 'commands', items: [], allItems: [], query: '', selectedIndex: 0 },
            });
        }
        const selectionCountAfterNoise = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set').length;
        expect(selectionCountAfterNoise).toBe(selectionCountBeforeNoise);

        // Overlay closed: a bare drag still cannot inherit old anchor.
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 20,
            y: 22,
            raw: '',
        }, baseState)).toBe(false);

        // Only a fresh press can start a new selection chain.
        expect(controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 20,
            y: 22,
            raw: '',
        }, baseState)).toBe(true);
        expect(controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 20,
            y: 25,
            raw: '',
        }, baseState)).toBe(true);

        const selectionEvents = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set');
        expect(selectionEvents.at(-1)).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 40, column: 19 },
                end: { line: 43, column: 19 },
            },
        });
    });
});
