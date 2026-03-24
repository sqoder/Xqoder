import { getTranscriptCopyHotspotBounds } from './copy-action.js';

export interface TranscriptMouseLayout {
    messages: { x: number; y: number; width: number; height: number };
}

export interface TranscriptMouseGeometry {
    transcriptStartRow: number;
    leftCol: number;
    scrollbarCol: number;
    lineIndex: number | null;
    column: number;
    copyHotspot: { left: number; right: number };
}

export interface TranscriptMousePoint {
    line: number;
    column: number;
}

export interface RustMessageHitLike {
    kind?: string;
    lineOffset?: number;
    line_offset?: number;
}

/**
 * 统一 transcript 鼠标坐标投影：
 * - row/col 只在这里转换成 transcript 行号与消息内列号
 * - controller 只消费投影结果，不再各自写 row - start / col - left 这种换算
 */
export function projectTranscriptMouseGeometry(
    layout: TranscriptMouseLayout,
    baseTopLine: number,
    row: number,
    col: number,
): TranscriptMouseGeometry {
    const transcriptStartRow = Math.max(0, Math.trunc(layout.messages.y));
    const leftCol = Math.max(0, Math.trunc(layout.messages.x));
    const scrollbarCol = Math.max(leftCol, Math.trunc(layout.messages.x + layout.messages.width));
    const lineIndex = row >= transcriptStartRow ? baseTopLine + (row - transcriptStartRow) : null;
    return {
        transcriptStartRow,
        leftCol,
        scrollbarCol,
        lineIndex,
        column: Math.max(0, col - leftCol),
        copyHotspot: getTranscriptCopyHotspotBounds(scrollbarCol),
    };
}

/**
 * 将 Rust 命中的 message 行偏移投影回 transcript 绝对行号。
 * controller 只关心“最终行号/列号”，不自己再拼 baseTopLine + lineOffset。
 */
export function projectTranscriptMessagePoint(
    baseTopLine: number,
    lineOffset: number,
    column: number,
    maxLine?: number | null,
): TranscriptMousePoint {
    const projectedLine = Math.max(0, Math.trunc(baseTopLine + lineOffset));
    const line = typeof maxLine === 'number'
        ? Math.max(0, Math.min(Math.trunc(maxLine), projectedLine))
        : projectedLine;
    return {
        line,
        column: Math.max(0, Math.trunc(column)),
    };
}

export function getRustMessageLineOffset(rustHit: RustMessageHitLike | null | undefined): number | null {
    const lineOffset = rustHit?.lineOffset ?? rustHit?.line_offset;
    return typeof lineOffset === 'number' ? lineOffset : null;
}

/**
 * 统一把 Rust message hit + 鼠标行列投影成 transcript selection 点。
 * 这层把 press/drag 的重复计算集中在 terminal-core。
 */
export function projectTranscriptSelectionPointFromRustHit(
    layout: TranscriptMouseLayout,
    baseTopLine: number,
    row: number,
    col: number,
    rustHit: RustMessageHitLike | null | undefined,
    maxLine?: number | null,
): TranscriptMousePoint | null {
    if (rustHit?.kind !== 'message') {
        return null;
    }
    const lineOffset = getRustMessageLineOffset(rustHit);
    if (lineOffset == null) {
        return null;
    }
    const geometry = projectTranscriptMouseGeometry(layout, baseTopLine, row, col);
    return projectTranscriptMessagePoint(baseTopLine, lineOffset, geometry.column, maxLine);
}
