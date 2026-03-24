import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MouseTranscriptController } from './mouse-transcript-controller.js';

const mocked = vi.hoisted(() => ({
    queryMessageViewport: vi.fn(() => ({ scrollOffset: 12, isFollowingBottom: false })),
    handleMouseEvent: vi.fn(() => true),
    computeLayout: vi.fn(),
    hitTest: vi.fn(),
    findEntryIndex: vi.fn(() => 0),
    isFoldedDiffMarker: vi.fn(() => false),
    copyTarget: vi.fn(async () => true),
    writeText: vi.fn(async () => undefined),
    writeToClipboardOSC52: vi.fn(),
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

describe('MouseTranscriptController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.queryMessageViewport.mockReset();
        mocked.queryMessageViewport.mockReturnValue({ scrollOffset: 12, isFollowingBottom: false });
        mocked.handleMouseEvent.mockReset();
        mocked.handleMouseEvent.mockReturnValue(true);
        mocked.computeLayout.mockReset();
        mocked.hitTest.mockReset();
        mocked.findEntryIndex.mockReset();
        mocked.findEntryIndex.mockReturnValue(0);
        mocked.isFoldedDiffMarker.mockReset();
        mocked.isFoldedDiffMarker.mockReturnValue(false);
        mocked.copyTarget.mockReset();
        mocked.copyTarget.mockResolvedValue(true);
        mocked.writeText.mockReset();
        mocked.writeText.mockResolvedValue(undefined);
        mocked.writeToClipboardOSC52.mockReset();
    });

    it('delegates chat parsed mouse interactions to rust and syncs viewport', () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow,
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 40,
            y: 12,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: { scrollOffset: 0, selectedRange: null },
        });

        expect(handled).toBe(true);
        expect(mocked.handleMouseEvent).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'press',
            button: 'left',
            col: 39,
            row: 11,
        }), 1);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.sync' });
        expect(renderNow).not.toHaveBeenCalled();
        expect(mocked.computeLayout).not.toHaveBeenCalled();
        expect(mocked.hitTest).not.toHaveBeenCalled();
    });

    it('does not synthesize chat message hits when rust hit-test says none', () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        mocked.computeLayout.mockReturnValueOnce({
            messages: { x: 0, y: 1, width: 80, height: 20 },
        });
        mocked.hitTest.mockReturnValueOnce({ kind: 'none' });

        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 10,
            y: 5,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: { scrollOffset: 0, selectedRange: null },
            transcriptCodeBlocks: [],
            transcriptLines: ['a', 'b', 'c'],
            overlay: null,
        });

        expect(handled).toBe(true);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'viewport.focusLine.set' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'viewport.selection.set' }));
    });

    it('copies the whole code block when clicking inside its copy hotspot', () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        mocked.computeLayout.mockReturnValueOnce({
            messages: { x: 0, y: 2, width: 80, height: 20 },
        });
        mocked.hitTest.mockReturnValueOnce({ kind: 'message', lineOffset: 6 });

        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 76,
            y: 9,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: { scrollOffset: 0, selectedRange: null },
            transcriptCodeBlocks: [{
                id: 'block-1',
                startLine: 5,
                endLine: 7,
                language: 'ts',
                text: 'console.log(1);',
            }],
            transcriptLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
            overlay: null,
            activeSessionId: 'session-1',
        });

        expect(handled).toBe(true);
        expect(mocked.copyTarget).toHaveBeenCalledWith(
            expect.objectContaining({
                transcriptCodeBlocks: expect.any(Array),
            }),
            { kind: 'code-block', blockId: 'block-1' },
            expect.anything(),
            expect.any(Function),
            expect.anything(),
        );
    });

    it('does not copy message targets from the transcript copy hotspot', () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        mocked.computeLayout.mockReturnValueOnce({
            messages: { x: 0, y: 2, width: 80, height: 20 },
        });
        mocked.hitTest.mockReturnValueOnce({ kind: 'message', lineOffset: 1 });

        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 76,
            y: 4,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: { scrollOffset: 0, selectedRange: null },
            transcriptCodeBlocks: [],
            transcriptEntryLineRanges: [{ entryId: 'm1', startLine: 1, endLine: 1 }],
            transcriptEntryLineStarts: [1],
            transcriptEntryLineEnds: [1],
            transcriptLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
            overlay: null,
            activeSessionId: 'session-1',
        });

        expect(handled).toBe(true);
        expect(mocked.copyTarget).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'viewport.selection.set' }));
    });

    it('copies the selected viewport text on mouse release and clears the selection', async () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow,
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'release',
            button: 'left',
            x: 10,
            y: 6,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: {
                scrollOffset: 0,
                selectedRange: {
                    start: { line: 0, column: 0 },
                    end: { line: 1, column: 6 },
                },
            },
            transcriptLines: ['alpha  ', 'beta  '],
        });

        expect(handled).toBe(true);
        expect(mocked.writeText).toHaveBeenCalledWith('alpha  \nbeta');
        await Promise.resolve();
        expect(mocked.writeToClipboardOSC52).toHaveBeenCalledWith('alpha  \nbeta', process.stdout);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'toast.push',
            text: 'Copied to clipboard',
            ttl: 3000,
        }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 1 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: undefined });
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.selection.set', selection: null });
        expect(renderNow).toHaveBeenCalled();
    });

    it('clears an empty selected viewport range on mouse release without copying', () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'release',
            button: 'left',
            x: 10,
            y: 6,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: {
                scrollOffset: 0,
                selectedRange: {
                    start: { line: 0, column: 0 },
                    end: { line: 0, column: 1 },
                },
            },
            transcriptLines: [''],
        });

        expect(handled).toBe(true);
        expect(mocked.writeText).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.focusLine.set', line: 0 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: undefined });
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.selection.set', selection: null });
    });

    it('clears selection anchor after release so later drag does not synthesize selection', () => {
        mocked.handleMouseEvent
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false);
        mocked.computeLayout
            .mockReturnValueOnce({ messages: { x: 0, y: 2, width: 80, height: 20 } })
            .mockReturnValueOnce({ messages: { x: 0, y: 2, width: 80, height: 20 } });
        mocked.hitTest
            .mockReturnValueOnce({ kind: 'message', lineOffset: 2 })
            .mockReturnValueOnce({ kind: 'message', lineOffset: 3 });

        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const baseState = {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            diffExpandedBlockIds: [],
            transcriptCodeBlocks: [],
            transcriptLines: Array.from({ length: 12 }, (_, index) => `line-${index}`),
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
            overlay: null,
        };

        const pressHandled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 10,
            y: 5,
            raw: '',
        }, {
            ...baseState,
            viewport: { scrollOffset: 0, selectedRange: null },
        });
        expect(pressHandled).toBe(true);

        const releaseHandled = controller.handle({
            type: 'mouse',
            kind: 'release',
            button: 'left',
            x: 10,
            y: 5,
            raw: '',
        }, {
            ...baseState,
            viewport: {
                scrollOffset: 0,
                selectedRange: {
                    start: { line: 2, column: 9 },
                    end: { line: 2, column: 9 },
                },
            },
        });
        expect(releaseHandled).toBe(true);

        const callCountBeforeDrag = dispatch.mock.calls.length;
        const dragHandled = controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 10,
            y: 6,
            raw: '',
        }, {
            ...baseState,
            viewport: {
                scrollOffset: 0,
                selectedRange: {
                    start: { line: 2, column: 9 },
                    end: { line: 2, column: 9 },
                },
            },
        });

        expect(dragHandled).toBe(false);
        expect(dispatch.mock.calls.length).toBe(callCountBeforeDrag);
    });

    it('normalizes reverse drag selection while keeping focus on drag end line', () => {
        mocked.handleMouseEvent
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false);
        mocked.computeLayout
            .mockReturnValueOnce({ messages: { x: 0, y: 2, width: 80, height: 20 } })
            .mockReturnValueOnce({ messages: { x: 0, y: 2, width: 80, height: 20 } });
        mocked.hitTest
            .mockReturnValueOnce({ kind: 'message', lineOffset: 6 })
            .mockReturnValueOnce({ kind: 'message', lineOffset: 2 });

        const dispatch = vi.fn();
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            stdout: process.stdout,
        });

        const baseState = {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            diffExpandedBlockIds: [],
            transcriptCodeBlocks: [],
            transcriptLines: Array.from({ length: 16 }, (_, index) => `line-${index}`),
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
            overlay: null,
            viewport: { scrollOffset: 0, selectedRange: null },
        };

        const pressHandled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 12,
            y: 10,
            raw: '',
        }, baseState);
        expect(pressHandled).toBe(true);

        const dragHandled = controller.handle({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 12,
            y: 6,
            raw: '',
        }, baseState);
        expect(dragHandled).toBe(true);

        const selectionEvents = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.selection.set');
        const focusEvents = dispatch.mock.calls
            .map((call) => call[0])
            .filter((event) => event?.type === 'viewport.focusLine.set');

        expect(selectionEvents.at(-1)).toEqual({
            type: 'viewport.selection.set',
            selection: {
                start: { line: 2, column: 11 },
                end: { line: 6, column: 11 },
            },
        });
        expect(focusEvents.at(-1)).toEqual({
            type: 'viewport.focusLine.set',
            line: 2,
        });
    });

    it('handles workflow step hits before generic message handling', () => {
        mocked.handleMouseEvent.mockReturnValueOnce(false);
        mocked.computeLayout.mockReturnValueOnce({
            messages: { x: 0, y: 2, width: 80, height: 20 },
        });
        mocked.hitTest.mockReturnValueOnce({ kind: 'workflow_step', id: 'step-42' });

        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new MouseTranscriptController({
            dispatch,
            renderNow,
            stdout: process.stdout,
        });

        const handled = controller.handle({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 10,
            y: 6,
            raw: '',
        }, {
            page: 'chat',
            editor: { value: '' },
            size: { width: 120, height: 30 },
            viewport: { scrollOffset: 0, selectedRange: null },
            diffExpandedBlockIds: [],
            transcriptCodeBlocks: [],
            transcriptLines: Array.from({ length: 10 }, (_, index) => `line-${index}`),
            transcriptEntryLineRanges: [],
            transcriptEntryLineStarts: [],
            transcriptEntryLineEnds: [],
            overlay: null,
            activeSessionId: 'session-1',
        });

        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'notice.set',
            notice: 'Workflow step: step-42',
        });
        expect(renderNow).toHaveBeenCalled();
    });
});
