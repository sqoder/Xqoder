import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { projectCompleteOverlayHit } from '../terminal-core/overlay-geometry.js';
import { createRustLayoutHitTestQuery } from '../terminal-core/rust-layout-hit-test-query.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import { toZeroBasedMousePoint } from '../terminal-core/mouse-geometry.js';

interface OverlayMouseControllerDeps {
    dispatch: (event: unknown) => void;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    recordCompleteSelection: (resolvedPath: string) => void;
    appendAttachment: (resolvedPath: string) => void;
}

interface OverlayRuntimeState {
    completeQuery: string;
    completeRootDir: string | null;
}

export class OverlayMouseController {
    constructor(private readonly deps: OverlayMouseControllerDeps) {}

    private hitTestOverlay(st: any, x: number, y: number) {
        const rustQuery = createRustLayoutHitTestQuery(st);
        const layout = rustQuery.computeOverlayLayout();
        const res = rustQuery.hitTest(x, y);

        if (res?.kind === 'overlay' && res.row != null && st.overlay) {
            const projection = projectCompleteOverlayHit(
                res.row,
                layout?.overlay?.height ?? 0,
                st.overlay.scrollOffset,
                st.overlay.items.length,
            );
            if (projection.anchorRow != null && projection.index != null) {
                return { insideBox: true, anchorRow: projection.anchorRow, index: projection.index };
            }
            return { insideBox: true, anchorRow: null, index: null };
        }

        return { insideBox: res?.kind === 'overlay', anchorRow: null, index: null };
    }

    handle(input: TerminalInputEvent, st: any, runtime: OverlayRuntimeState): { handled: boolean; state: OverlayRuntimeState } {
        let next = { ...runtime };

        if (st.overlay.type === 'complete' && input.type === 'mouse' && input.kind !== 'scroll') {
            const point = toZeroBasedMousePoint(input);
            const resolved = this.hitTestOverlay(st, point.col, point.row);
            if (resolved.index != null) {
                this.deps.dispatch({ type: 'overlay.completeSetSelected', index: resolved.index });
            }
            if (input.kind !== 'press') {
                return { handled: true, state: next };
            }
        }

        if (st.overlay.type === 'complete' && input.type === 'mouse' && (input.button === 'wheelUp' || input.button === 'wheelDown')) {
            const point = toZeroBasedMousePoint(input);
            const resolved = this.hitTestOverlay(st, point.col, point.row);
            if (resolved.anchorRow == null) {
                return { handled: true, state: next };
            }
            const delta: 1 | -1 = input.button === 'wheelUp' ? -1 : 1;
            this.deps.dispatch({ type: 'overlay.completeScrollAt', delta, anchorRow: resolved.anchorRow });
            return { handled: true, state: next };
        }

        if (st.overlay.type === 'complete' && input.type === 'mouse' && input.kind === 'press' && input.button === 'left') {
            const point = toZeroBasedMousePoint(input);
            const resolved = this.hitTestOverlay(st, point.col, point.row);
            if (!resolved.insideBox) {
                next = { completeQuery: '', completeRootDir: null };
                this.deps.dispatch({ type: 'overlay.close' });
                return { handled: true, state: next };
            }
            if (resolved.index == null) {
                return { handled: true, state: next };
            }
            const selected = st.overlay.items[resolved.index] as { path: string; isDir: boolean } | undefined;
            if (!selected) {
                return { handled: true, state: next };
            }
            this.deps.dispatch({ type: 'overlay.completeSetSelected', index: resolved.index });
            if (selected.isDir) {
                if (st.overlay.expandedDirs.includes(selected.path)) {
                    this.deps.dispatch({ type: 'overlay.completeCollapse', path: selected.path });
                } else {
                    const children = this.deps.loadFilepickerEntries(selected.path);
                    this.deps.dispatch({ type: 'overlay.completeExpand', path: selected.path, children });
                }
            } else {
                next = { completeQuery: '', completeRootDir: null };
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'complete', path: selected.path });
                this.deps.recordCompleteSelection(selected.path);
                this.deps.appendAttachment(selected.path);
            }
            return { handled: true, state: next };
        }

        return { handled: false, state: next };
    }
}
