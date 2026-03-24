import { estimateInputLinesForLayout } from './input-layout.js';
import { resolveOverlayLayoutProps } from './overlay-layout-props.js';
import { rustTui } from './rust-tui.js';

interface RustLayoutHitTestQueryState {
    size: { width: number; height: number };
    editor?: { value?: string };
    overlay?: unknown;
}

interface RustLayoutHitTestQueryOptions {
    overlayMinimumItemCount?: number;
    overlayItemCount?: number;
    overlayMaxWidth?: number | null;
}

export function createRustLayoutHitTestQuery(
    state: RustLayoutHitTestQueryState,
    options: RustLayoutHitTestQueryOptions = {},
) {
    const cols = state.size.width;
    const rows = state.size.height;
    const inputLines = estimateInputLinesForLayout(state.editor?.value ?? '');
    const resolvedOverlayLayout = resolveOverlayLayoutProps(
        state.overlay,
        options.overlayMinimumItemCount ?? 0,
    );
    const overlayItemCount = typeof options.overlayItemCount === 'number'
        ? Math.max(0, Math.trunc(options.overlayItemCount))
        : resolvedOverlayLayout.itemCount;
    const overlayMaxWidth = options.overlayMaxWidth ?? resolvedOverlayLayout.maxWidth;

    return {
        cols,
        rows,
        inputLines,
        overlayItemCount,
        overlayMaxWidth,
        computeBaseLayout() {
            return rustTui.computeLayout(cols, rows, inputLines);
        },
        computeOverlayLayout() {
            return rustTui.computeLayout(
                cols,
                rows,
                inputLines,
                overlayItemCount,
                overlayMaxWidth,
            );
        },
        hitTest(col: number, row: number) {
            return rustTui.hitTest(
                cols,
                rows,
                inputLines,
                overlayItemCount,
                overlayMaxWidth,
                col,
                row,
            );
        },
    };
}
