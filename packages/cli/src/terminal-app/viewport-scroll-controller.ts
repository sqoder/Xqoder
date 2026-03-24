import { rustTui } from '../terminal-core/rust-tui.js';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { getProjectedActiveViewportHeight } from '../terminal-core/runtime-bridge.js';

interface ViewportScrollControllerDeps {
    dispatch: (event: unknown) => void;
    getState: () => any;
    renderNow: () => Promise<unknown>;
}

const VIEWPORT_SCROLL_STEP = 3;
const PAGE_SCROLL_RATIO = 0.85;

export class ViewportScrollController {
    private wheelInertiaTimers: Array<ReturnType<typeof setTimeout>> = [];

    constructor(private readonly deps: ViewportScrollControllerDeps) {}

    private cancelWheelInertia(): void {
        for (const timer of this.wheelInertiaTimers) {
            clearTimeout(timer);
        }
        this.wheelInertiaTimers = [];
    }

    handle(input: TerminalInputEvent): boolean {
        if (!(input.type === 'mouse' && (input.button === 'wheelUp' || input.button === 'wheelDown'))) {
            this.cancelWheelInertia();
        }

        const mainPage = this.deps.getState().page;
        const dispatchViewportScroll = (delta: number): void => {
            const activePage = this.deps.getState().page;
            this.deps.dispatch(activePage === 'logs'
                ? { type: 'logViewport.scroll' as const, delta }
                : { type: 'viewport.scroll' as const, delta });
        };

        const pageChat = (direction: 'up' | 'down'): boolean => {
            this.deps.dispatch({ type: 'viewport.page', direction });
            return true;
        };

        const homeChat = (): boolean => {
            this.deps.dispatch({ type: 'viewport.home' });
            return true;
        };

        const endChat = (): boolean => {
            this.deps.dispatch({ type: 'viewport.end' });
            return true;
        };

        const scrollEvent = (delta: number) => mainPage === 'logs'
            ? { type: 'logViewport.scroll' as const, delta }
            : { type: 'viewport.scroll' as const, delta };
        const pageEvent = (direction: 'up' | 'down') => mainPage === 'logs'
            ? { type: 'logViewport.page' as const, direction }
            : { type: 'viewport.page' as const, direction };

        if (input.type === 'mouse' && (input.button === 'wheelUp' || input.button === 'wheelDown')) {
            const baseDelta = input.button === 'wheelUp' ? -VIEWPORT_SCROLL_STEP : VIEWPORT_SCROLL_STEP;
            this.cancelWheelInertia();
            const deltas = rustTui.inertialScrollDeltas(baseDelta, 5);
            deltas.forEach((delta, index) => {
                const timer = setTimeout(() => {
                    dispatchViewportScroll(delta);
                }, index * 16);
                this.wheelInertiaTimers.push(timer);
            });
            return true;
        }

        if (input.type === 'key') {
            if (input.key === 'escape') {
                const state = this.deps.getState();
                    if (state.viewport.selectedRange) {
                    this.deps.dispatch({ type: 'viewport.selection.set', selection: null });
                    return true;
                }
            }
            if (input.key === 'g' && input.ctrl && !input.alt) {
                this.deps.dispatch(mainPage === 'logs' ? { type: 'logViewport.home' } : { type: 'viewport.home' });
                return true;
            }
            if (input.ctrl && input.alt) {
                if (input.key === 'g') {
                    this.deps.dispatch(mainPage === 'logs' ? { type: 'logViewport.end' } : { type: 'viewport.end' });
                    return true;
                }
                if (input.key === 'y' || input.key === 'e') {
                    if (mainPage === 'chat') {
                        this.deps.dispatch({ type: 'viewport.scroll', delta: input.key === 'y' ? -1 : 1 });
                    } else {
                        this.deps.dispatch(scrollEvent(input.key === 'y' ? -1 : 1));
                    }
                    return true;
                }
                if (input.key === 'u' || input.key === 'd') {
                    const st = this.deps.getState();
                    const viewportH = getProjectedActiveViewportHeight(st);
                    const halfStep = Math.max(1, Math.floor(viewportH / 2));
                    if (mainPage === 'chat') {
                        this.deps.dispatch({ type: 'viewport.scroll', delta: input.key === 'u' ? -halfStep : halfStep });
                    } else {
                        this.deps.dispatch(scrollEvent(input.key === 'u' ? -halfStep : halfStep));
                    }
                    return true;
                }
            }
            if (input.key === 'up' && input.shift) {
                if (mainPage === 'chat') {
                    this.deps.dispatch({ type: 'viewport.scroll', delta: -VIEWPORT_SCROLL_STEP });
                } else {
                    this.deps.dispatch(scrollEvent(-VIEWPORT_SCROLL_STEP));
                }
                return true;
            }
            if (input.key === 'down' && input.shift) {
                if (mainPage === 'chat') {
                    this.deps.dispatch({ type: 'viewport.scroll', delta: VIEWPORT_SCROLL_STEP });
                } else {
                    this.deps.dispatch(scrollEvent(VIEWPORT_SCROLL_STEP));
                }
                return true;
            }
            if (input.key === 'home') {
                if (mainPage === 'chat') {
                    return homeChat();
                }
                this.deps.dispatch(mainPage === 'logs' ? { type: 'logViewport.home' } : { type: 'viewport.home' });
                return true;
            }
            if (input.key === 'end') {
                if (mainPage === 'chat') {
                    return endChat();
                }
                this.deps.dispatch(mainPage === 'logs' ? { type: 'logViewport.end' } : { type: 'viewport.end' });
                return true;
            }
            if (input.key === 'pageup') {
                if (mainPage === 'chat') {
                    return pageChat('up');
                }
                this.deps.dispatch(pageEvent('up'));
                return true;
            }
            if (input.key === 'pagedown') {
                if (mainPage === 'chat') {
                    return pageChat('down');
                }
                this.deps.dispatch(pageEvent('down'));
                return true;
            }
        }

        return false;
    }

    dispose(): void {
        this.cancelWheelInertia();
    }
}
