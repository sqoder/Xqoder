import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { createRustLayoutHitTestQuery } from '../terminal-core/rust-layout-hit-test-query.js';
import { toZeroBasedMousePoint } from '../terminal-core/mouse-geometry.js';

interface OverlayLayerRuntimeState {
    completeQuery: string;
    completeRootDir: string | null;
}

interface OverlayLayerControllerDeps {
    dispatch: (event: unknown) => void;
    onDismissInit: () => void;
}

export class OverlayLayerController {
    constructor(private readonly deps: OverlayLayerControllerDeps) {}

    handle(input: TerminalInputEvent, state: any, runtime: OverlayLayerRuntimeState): { handled: boolean; state: OverlayLayerRuntimeState } {
        const next = { ...runtime };
        if (!state.overlay) {
            return { handled: false, state: next };
        }

        if (input.type === 'key' && input.key === 'escape') {
            if (state.overlay.type === 'init') {
                this.deps.onDismissInit();
            }
            if (state.overlay.type === 'complete') {
                next.completeQuery = '';
                next.completeRootDir = null;
            }
            this.deps.dispatch({ type: 'overlay.close' });
            return { handled: true, state: next };
        }

        if (
            input.type === 'key'
            && input.key === 'backspace'
            && state.overlay.type === 'commands'
            && state.overlay.query.length === 0
            && state.overlayStack.length > 0
        ) {
            this.deps.dispatch({ type: 'overlay.close' });
            return { handled: true, state: next };
        }

        if (
            input.type === 'key'
            && input.key === 'enter'
            && !input.ctrl
            && !input.alt
            && state.overlay.type === 'commands'
            && state.overlay.items.length === 0
            && state.overlayStack.length > 0
        ) {
            this.deps.dispatch({ type: 'overlay.close' });
            return { handled: true, state: next };
        }

        if (
            input.type === 'mouse'
            && input.kind === 'press'
            && input.button === 'left'
            && state.overlay.type !== 'complete'
        ) {
            const point = toZeroBasedMousePoint(input);
            const rustQuery = createRustLayoutHitTestQuery(state, { overlayMinimumItemCount: 1 });
            const res = rustQuery.hitTest(point.col, point.row);
            if (res?.kind !== 'overlay') {
                this.deps.dispatch({ type: 'overlay.close' });
                return { handled: true, state: next };
            }
        }

        return { handled: false, state: next };
    }
}
