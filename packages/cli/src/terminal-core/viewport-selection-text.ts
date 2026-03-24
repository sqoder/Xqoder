import stringWidth from 'string-width';
import type { ViewportSelection, ViewportPoint } from './viewport-model.js';
import { normalizeViewportSelection } from './viewport-model.js';

function displayColumnToIndex(text: string, column: number): number {
    let width = 0;
    let index = 0;
    for (const char of text) {
        const nextWidth = width + Math.max(1, stringWidth(char));
        if (nextWidth > column) {
            break;
        }
        width = nextWidth;
        index += char.length;
    }
    return index;
}

/**
 * 根据 viewport 选区把多行转成要复制的纯文本。
 *
 * 注意：这里服务于“复制”，不参与渲染布局/滚动等算法。
 */
export function buildViewportSelectedText(lines: string[], selection: ViewportSelection | null): string {
    if (!selection) {
        return '';
    }

    const normalized = normalizeViewportSelection(selection.start, selection.end);
    const chunks: string[] = [];

    for (let index = normalized.start.line; index <= normalized.end.line; index += 1) {
        const line = lines[index] ?? '';
        const startIndex = index === normalized.start.line ? displayColumnToIndex(line, normalized.start.column) : 0;
        const endIndex = index === normalized.end.line ? displayColumnToIndex(line, normalized.end.column) : line.length;
        chunks.push(line.slice(startIndex, Math.max(startIndex, endIndex)));
    }

    return chunks.join('\n');
}

/**
 * 复制语义下的 viewport 选区文本。
 * 这里统一只去掉整段末尾的留白，不改动中间行的内容。
 */
export function getViewportSelectionCopyText(lines: string[], selection: ViewportSelection | null): string {
    return buildViewportSelectedText(lines, selection).trimEnd();
}

// Re-export for convenience in controllers/tests.
export type { ViewportSelection, ViewportPoint };
