import type { TerminalInputEvent } from './input-parser.js';

export interface ZeroBasedMousePoint {
    row: number;
    col: number;
}

/**
 * 统一把终端鼠标坐标从 1-based 转成 0-based。
 * controller 不应该各自重复写 `x - 1` / `y - 1`。
 */
export function toZeroBasedMousePoint(input: Extract<TerminalInputEvent, { type: 'mouse' }>): ZeroBasedMousePoint {
    return {
        col: Math.max(0, Math.trunc(input.x) - 1),
        row: Math.max(0, Math.trunc(input.y) - 1),
    };
}
