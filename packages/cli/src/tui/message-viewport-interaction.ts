import type { TranscriptSelectionPoint } from './message-viewport-state.js';

export interface ParsedMouseInput {
    code: number;
    x: number;
    y: number;
    action: 'press' | 'release';
}

export interface HitRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScrollbarHitOptions {
    anchor: { x: number; y: number };
    width: number;
    height: number;
}

export interface TranscriptPointOptions {
    anchor: { x: number; y: number };
    topLine: number;
    visibleLineCount: number;
    maxColumn?: number;
    clampOutside?: boolean;
}

const sgrRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

export function parseMouseInput(input: string): ParsedMouseInput | null {
    const match = sgrRe.exec(input);
    if (!match) {
        return null;
    }

    return {
        code: Number.parseInt(match[1] ?? '0', 10),
        x: Number.parseInt(match[2] ?? '1', 10),
        y: Number.parseInt(match[3] ?? '1', 10),
        action: match[4] === 'm' ? 'release' : 'press',
    };
}

export function isPointInRect(pointerX: number, pointerY: number, rect: HitRect): boolean {
    const x = pointerX - 1;
    const y = pointerY - 1;
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function isScrollbarHit(pointerX: number, pointerY: number, options: ScrollbarHitOptions): boolean {
    return isPointInRect(pointerX, pointerY, {
        x: options.anchor.x,
        y: options.anchor.y,
        width: options.width,
        height: options.height,
    });
}

export function isScrollbarThumbHit(
    pointerX: number,
    pointerY: number,
    options: ScrollbarHitOptions,
    thumbTop: number,
    thumbHeight: number,
    grabSlop: number = 0,
): boolean {
    if (!isScrollbarHit(pointerX, pointerY, options)) {
        return false;
    }

    const relativeRow = pointerY - 1 - options.anchor.y;
    return relativeRow >= thumbTop - grabSlop && relativeRow < thumbTop + thumbHeight + grabSlop;
}

export function pointFromTranscript(pointerX: number, pointerY: number, options: TranscriptPointOptions): TranscriptSelectionPoint | null {
    const rawX = pointerX - 1 - options.anchor.x;
    const rawY = pointerY - 1 - options.anchor.y;
    if (!options.clampOutside && (rawY < 0 || rawY >= options.visibleLineCount)) {
        return null;
    }

    const clampedY = Math.max(0, Math.min(options.visibleLineCount - 1, rawY));
    const x = options.maxColumn === undefined
        ? Math.max(0, rawX)
        : Math.max(0, Math.min(options.maxColumn, rawX));

    return {
        line: options.topLine + clampedY,
        column: x,
    };
}
