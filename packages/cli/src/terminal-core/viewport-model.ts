/**
 * Viewport projection model (纯状态投影)
 *
 * 边界约束：
 * - 不承载渲染算法（thumb / hit / wrap / 文本测量都不在这里）
 * - 不承载“怎么算下一帧位置”的逻辑（滚动/跳转/可视区计算都在 controller 或 Rust）
 *
 * 本文件只定义 UI 侧持有的投影快照与最少量的纯数据变换。
 */

export interface ViewportPoint {
    line: number;
    column: number;
}

export interface ViewportSelection {
    start: ViewportPoint;
    end: ViewportPoint;
}

export interface ViewportModel {
    /** transcript 行号偏移。chat 页该值只是 Rust viewport 的投影快照，不是事实源。 */
    scrollOffset: number;
    /** 跟底状态。chat 页该值只是 Rust viewport 的投影快照，不是事实源。 */
    isFollowingBottom: boolean;
    /** transcript 选区（对应原 selection） */
    selectedRange: ViewportSelection | null;
    /** 光标/鼠标所在的 transcript 行号（对应原 focusLine），用于复制/跳转锚点 */
    anchorMessageId: number | null;
    /** 当前可视高度（单位：行）。chat 页该值是 Rust layout 的投影快照，不是事实源。 */
    viewportHeight: number;
}

export function createViewportModel(): ViewportModel {
    return {
        scrollOffset: 0,
        isFollowingBottom: true,
        selectedRange: null,
        anchorMessageId: null,
        viewportHeight: 0,
    };
}

export function normalizeViewportSelection(start: ViewportPoint, end: ViewportPoint): ViewportSelection {
    if (start.line < end.line) {
        return { start, end };
    }
    if (start.line > end.line) {
        return { start: end, end: start };
    }
    return start.column <= end.column ? { start, end } : { start: end, end: start };
}
