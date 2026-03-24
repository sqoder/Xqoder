import type { RustTuiLayout } from './rust-renderer.js';

const FALLBACK_HEADER_HEIGHT = 1;
const FALLBACK_INPUT_HEIGHT = 3;
const FALLBACK_FOOTER_HEIGHT = 2;

/**
 * Rust layout 不可用时的最小兜底布局。
 *
 * 这里只做占位，不承载任何真实渲染算法；
 * 真正的布局、命中和滚动都应由 Rust 负责。
 */
export function buildFallbackLayout(cols: number, rows: number): RustTuiLayout {
    const headerHeight = FALLBACK_HEADER_HEIGHT;
    const inputHeight = FALLBACK_INPUT_HEIGHT;
    const footerHeight = FALLBACK_FOOTER_HEIGHT;
    const messagesHeight = Math.max(1, rows - headerHeight - inputHeight - footerHeight);
    const inputY = Math.max(1, rows - inputHeight - footerHeight);
    const footerY = Math.max(1, rows - footerHeight);

    return {
        header: { x: 0, y: 0, width: cols, height: headerHeight },
        messages: { x: 0, y: headerHeight, width: cols, height: messagesHeight },
        messagesScrollbar: null,
        input: { x: 0, y: inputY, width: cols, height: inputHeight },
        footer: { x: 0, y: footerY, width: cols, height: footerHeight },
        sidebar: { x: cols, y: 0, width: 0, height: rows },
        hasSidebar: false,
    };
}
