import type { TranscriptSelectionPoint } from './transcript-selection-events.js';

function normalizeAnchorPoint(point: TranscriptSelectionPoint): TranscriptSelectionPoint {
    return {
        line: Math.max(0, Math.trunc(point.line)),
        column: Math.max(0, Math.trunc(point.column)),
    };
}

export interface SelectionAnchorLifecycle {
    has(): boolean;
    current(): TranscriptSelectionPoint | null;
    press(point: TranscriptSelectionPoint): TranscriptSelectionPoint;
    drag(end: TranscriptSelectionPoint): { start: TranscriptSelectionPoint; end: TranscriptSelectionPoint } | null;
    release(): TranscriptSelectionPoint | null;
    clear(): void;
}

/**
 * 统一 selection anchor 生命周期：
 * press -> drag* -> release/clear
 */
export function createSelectionAnchorLifecycle(): SelectionAnchorLifecycle {
    let anchor: TranscriptSelectionPoint | null = null;

    return {
        has() {
            return anchor != null;
        },
        current() {
            return anchor ? { ...anchor } : null;
        },
        press(point: TranscriptSelectionPoint) {
            anchor = normalizeAnchorPoint(point);
            return { ...anchor };
        },
        drag(end: TranscriptSelectionPoint) {
            if (!anchor) {
                return null;
            }
            return {
                start: { ...anchor },
                end: normalizeAnchorPoint(end),
            };
        },
        release() {
            const previous = anchor ? { ...anchor } : null;
            anchor = null;
            return previous;
        },
        clear() {
            anchor = null;
        },
    };
}
