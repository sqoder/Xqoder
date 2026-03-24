export interface CompleteOverlayProjection {
    listStartRow: number;
    visibleRows: number;
    selectableRows: number;
    anchorRow: number | null;
    index: number | null;
}

const COMPLETE_OVERLAY_LIST_START_ROW_OFFSET = 2;
const COMPLETE_OVERLAY_VISIBLE_ROWS_PADDING = 3;
const COMPLETE_OVERLAY_VISIBLE_ROWS_FALLBACK = 8;

export function getCompleteOverlayVisibleRows(overlayHeight: number, itemCount: number): number {
    const safeItemCount = Math.max(0, Math.trunc(itemCount));
    if (safeItemCount === 0) {
        return 0;
    }

    const projectedRows = Math.max(0, Math.trunc(overlayHeight) - COMPLETE_OVERLAY_VISIBLE_ROWS_PADDING);
    if (projectedRows > 0) {
        return Math.max(1, Math.min(safeItemCount, projectedRows));
    }

    return Math.min(safeItemCount, COMPLETE_OVERLAY_VISIBLE_ROWS_FALLBACK);
}

export function getCompleteOverlayListStartRow(): number {
    return COMPLETE_OVERLAY_LIST_START_ROW_OFFSET;
}

export function projectCompleteOverlayHit(
    relativeRow: number,
    overlayHeight: number,
    scrollOffset: number,
    itemCount: number,
): CompleteOverlayProjection {
    const listStartRow = getCompleteOverlayListStartRow();
    const visibleRows = getCompleteOverlayVisibleRows(overlayHeight, itemCount);
    const safeScrollOffset = Math.max(0, Math.trunc(scrollOffset));
    const safeItemCount = Math.max(0, Math.trunc(itemCount));
    const visibleItemCount = Math.max(0, safeItemCount - safeScrollOffset);
    const selectableRows = Math.min(visibleRows, visibleItemCount);
    const anchorRow = Math.trunc(relativeRow) - listStartRow;
    const isSelectable = anchorRow >= 0 && anchorRow < selectableRows;

    return {
        listStartRow,
        visibleRows,
        selectableRows,
        anchorRow: isSelectable ? anchorRow : null,
        index: isSelectable ? safeScrollOffset + anchorRow : null,
    };
}
