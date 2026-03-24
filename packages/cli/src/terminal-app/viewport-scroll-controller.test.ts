import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportScrollController } from './viewport-scroll-controller.js';

const mocked = vi.hoisted(() => ({
    inertialScrollDeltas: vi.fn(() => [3, 2, 1]),
}));

vi.mock('../terminal-core/rust-tui.js', () => ({
    rustTui: {
        inertialScrollDeltas: mocked.inertialScrollDeltas,
    },
}));

describe('ViewportScrollController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it('dispatches inertial wheel scroll deltas', () => {
        vi.useFakeTimers();
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new ViewportScrollController({
            dispatch,
            getState: () => ({ page: 'chat', viewport: {} }),
            renderNow,
        });

        const handled = controller.handle({ type: 'mouse', kind: 'press', button: 'wheelDown', x: 1, y: 1, raw: '' });
        expect(handled).toBe(true);

        vi.runAllTimers();
        expect(dispatch).toHaveBeenNthCalledWith(1, { type: 'viewport.scroll', delta: 3 });
        expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'viewport.scroll', delta: 2 });
        expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'viewport.scroll', delta: 1 });
        expect(renderNow).not.toHaveBeenCalled();
    });

    it('clears viewport selection on escape', () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new ViewportScrollController({
            dispatch,
            getState: () => ({ page: 'chat', viewport: { selectedRange: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } } } }),
            renderNow,
        });

        const handled = controller.handle({ type: 'key', key: 'escape', raw: '' });
        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.selection.set', selection: null });
    });

    it('uses half-page delta for ctrl+alt+u', () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new ViewportScrollController({
            dispatch,
            getState: () => ({ page: 'chat', viewport: { viewportHeight: 10 } }),
            renderNow,
        });

        const handled = controller.handle({ type: 'key', key: 'u', ctrl: true, alt: true, raw: '' });
        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.scroll', delta: -5 });
        expect(renderNow).not.toHaveBeenCalled();
    });

    it('falls back to projected chat viewport height when ctrl+alt+u has no viewportHeight snapshot yet', () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new ViewportScrollController({
            dispatch,
            getState: () => ({
                page: 'chat',
                size: { width: 80, height: 24 },
                viewport: { viewportHeight: 0 },
            }),
            renderNow,
        });

        const handled = controller.handle({ type: 'key', key: 'u', ctrl: true, alt: true, raw: '' });
        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.scroll', delta: -8 });
    });

    it('handles page/home/end shortcuts in chat page', () => {
        const dispatch = vi.fn();
        const renderNow = vi.fn(async () => undefined);
        const controller = new ViewportScrollController({
            dispatch,
            getState: () => ({ page: 'chat', viewport: {}, size: { width: 120, height: 30 } }),
            renderNow,
        });

        const upHandled = controller.handle({ type: 'key', key: 'pageup', raw: '' });
        expect(upHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.page', direction: 'up' });

        dispatch.mockClear();
        const downHandled = controller.handle({ type: 'key', key: 'pagedown', raw: '' });
        expect(downHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.page', direction: 'down' });

        dispatch.mockClear();
        const homeHandled = controller.handle({ type: 'key', key: 'home', raw: '' });
        expect(homeHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.home' });

        dispatch.mockClear();
        const endHandled = controller.handle({ type: 'key', key: 'end', raw: '' });
        expect(endHandled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'viewport.end' });
        expect(renderNow).not.toHaveBeenCalled();
    });
});
