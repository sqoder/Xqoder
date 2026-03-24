import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayMouseController } from './overlay-mouse-controller.js';

const mocked = vi.hoisted(() => ({
    computeLayout: vi.fn(),
    hitTest: vi.fn(),
}));

vi.mock('../terminal-core/rust-tui.js', () => ({
    rustTui: {
        computeLayout: mocked.computeLayout,
        hitTest: mocked.hitTest,
    },
}));

describe('OverlayMouseController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('selects visible complete rows from Rust overlay hit-test rows', () => {
        mocked.computeLayout.mockReturnValue({ overlay: { height: 11 } });
        mocked.hitTest.mockReturnValue({ kind: 'overlay', row: 5 });

        const dispatch = vi.fn();
        const controller = new OverlayMouseController({
            dispatch,
            loadFilepickerEntries: vi.fn(() => []),
            recordCompleteSelection: vi.fn(),
            appendAttachment: vi.fn(),
        });

        const result = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 4, y: 6, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor: { value: '' },
                overlay: {
                    type: 'complete',
                    currentDir: '/tmp',
                    items: Array.from({ length: 10 }, (_, index) => ({
                        path: `/tmp/item-${index}.ts`,
                        label: `item-${index}.ts`,
                        isDir: false,
                    })),
                    expandedDirs: [],
                    selectedIndex: 0,
                    scrollOffset: 0,
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.completeSetSelected', index: 3 });
    });

    it('ignores blank rows below the visible complete overlay items', () => {
        mocked.computeLayout.mockReturnValue({ overlay: { height: 11 } });
        mocked.hitTest.mockReturnValue({ kind: 'overlay', row: 10 });

        const dispatch = vi.fn();
        const controller = new OverlayMouseController({
            dispatch,
            loadFilepickerEntries: vi.fn(() => []),
            recordCompleteSelection: vi.fn(),
            appendAttachment: vi.fn(),
        });

        const result = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 4, y: 11, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor: { value: '' },
                overlay: {
                    type: 'complete',
                    currentDir: '/tmp',
                    items: Array.from({ length: 10 }, (_, index) => ({
                        path: `/tmp/item-${index}.ts`,
                        label: `item-${index}.ts`,
                        isDir: false,
                    })),
                    expandedDirs: [],
                    selectedIndex: 0,
                    scrollOffset: 0,
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'overlay.completeSetSelected' }));
    });

    it('maps visible complete rows through scroll offset before selecting items', () => {
        mocked.computeLayout.mockReturnValue({ overlay: { height: 11 } });
        mocked.hitTest.mockReturnValue({ kind: 'overlay', row: 4 });

        const dispatch = vi.fn();
        const controller = new OverlayMouseController({
            dispatch,
            loadFilepickerEntries: vi.fn(() => []),
            recordCompleteSelection: vi.fn(),
            appendAttachment: vi.fn(),
        });

        const result = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 4, y: 5, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor: { value: '' },
                overlay: {
                    type: 'complete',
                    currentDir: '/tmp',
                    items: Array.from({ length: 10 }, (_, index) => ({
                        path: `/tmp/item-${index}.ts`,
                        label: `item-${index}.ts`,
                        isDir: false,
                    })),
                    expandedDirs: [],
                    selectedIndex: 0,
                    scrollOffset: 2,
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.completeSetSelected', index: 4 });
    });
});
