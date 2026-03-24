import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayLayerController } from './overlay-layer-controller.js';

const mocked = vi.hoisted(() => ({
    hitTest: vi.fn(),
}));

vi.mock('../terminal-core/rust-tui.js', () => ({
    rustTui: {
        hitTest: mocked.hitTest,
    },
}));

describe('OverlayLayerController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closes top overlay on escape and resets complete query', () => {
        const dispatch = vi.fn();
        const onDismissInit = vi.fn();
        const controller = new OverlayLayerController({ dispatch, onDismissInit });

        const result = controller.handle(
            { type: 'key', key: 'escape', raw: '' },
            {
                size: { width: 120, height: 30 },
                overlay: { type: 'complete', items: [], selectedIndex: 0, currentDir: '/repo', expandedDirs: [], scrollOffset: 0 },
                overlayStack: [{ type: 'commands', items: [], allItems: [], query: '', selectedIndex: 0 }],
            },
            { completeQuery: 'src', completeRootDir: '/repo' },
        );

        expect(result.handled).toBe(true);
        expect(result.state.completeQuery).toBe('');
        expect(result.state.completeRootDir).toBeNull();
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.close' });
        expect(onDismissInit).not.toHaveBeenCalled();
    });

    it('closes commands overlay on backspace when query empty and stacked', () => {
        const dispatch = vi.fn();
        const controller = new OverlayLayerController({ dispatch, onDismissInit: vi.fn() });
        const result = controller.handle(
            { type: 'key', key: 'backspace', raw: '' },
            {
                size: { width: 120, height: 30 },
                overlay: { type: 'commands', items: [], allItems: [], query: '', selectedIndex: 0 },
                overlayStack: [{ type: 'session', items: [], selectedIndex: 0 }],
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.close' });
    });

    it('closes non-complete overlay when mouse clicks outside', () => {
        mocked.hitTest.mockReturnValue({ kind: 'none' });
        const dispatch = vi.fn();
        const controller = new OverlayLayerController({ dispatch, onDismissInit: vi.fn() });
        const result = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 1, y: 1, raw: '' },
            {
                size: { width: 120, height: 30 },
                overlay: {
                    type: 'commands',
                    items: [{ id: 'session', label: 'Session' }],
                    allItems: [{ id: 'session', label: 'Session' }],
                    query: 's',
                    selectedIndex: 0,
                },
                overlayStack: [],
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.close' });
    });

    it('keeps an empty non-complete overlay box clickable by clamping item count to at least one', () => {
        mocked.hitTest.mockReturnValue({ kind: 'overlay' });
        const dispatch = vi.fn();
        const controller = new OverlayLayerController({ dispatch, onDismissInit: vi.fn() });

        const result = controller.handle(
            { type: 'mouse', kind: 'press', button: 'left', x: 3, y: 3, raw: '' },
            {
                size: { width: 120, height: 30 },
                editor: { value: '' },
                overlay: {
                    type: 'commands',
                    items: [],
                    allItems: [],
                    query: '',
                    selectedIndex: 0,
                },
                overlayStack: [],
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(false);
        expect(mocked.hitTest).toHaveBeenCalledWith(120, 30, 1, 1, null, 2, 2);
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'overlay.close' });
    });
});
