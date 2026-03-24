import { describe, expect, it } from 'vitest';
import type { TerminalTranscriptEntry } from './app-state.js';
import { getCompleteOverlayVisibleRows, projectCompleteOverlayHit } from './overlay-geometry.js';
import { projectTranscriptMessagePoint, projectTranscriptMouseGeometry, projectTranscriptSelectionPointFromRustHit } from './transcript-mouse-geometry.js';
import { rustTui } from './rust-tui.js';
import { rebuildTranscriptWithCodeBlocks } from './transcript-blocks.js';
import { getTranscriptEntryRangeAtLine } from './transcript-line-mapping.js';
import {
    buildTranscriptScrollbarModel,
    resolveTranscriptTopLineFromJump,
    resolveTranscriptTopLineFromScrollbar,
} from './transcript-viewport-queries.js';

interface ContractFixture {
    starts: number[];
    ends: number[];
    totalLines: number;
}

function buildContractFixture(): ContractFixture {
    const entryHeights = [3, 4, 2, 5, 3];
    const starts: number[] = [];
    const ends: number[] = [];
    let line = 0;
    for (const height of entryHeights) {
        starts.push(line);
        ends.push(line + height - 1);
        line += height;
    }
    return { starts, ends, totalLines: line };
}

function buildTranscriptFixtureFromEntries() {
    const entries: TerminalTranscriptEntry[] = [
        {
            id: 'entry-user-1',
            role: 'user',
            content: 'Summarize the latest compiler error and propose a fix.',
            timestamp: 1700000000000,
        },
        {
            id: 'entry-tool-1',
            role: 'tool',
            content: 'read_file\nsrc/main.ts',
            isStreaming: false,
            success: true,
            timestamp: 1700000000100,
        },
        {
            id: 'entry-assistant-1',
            role: 'assistant',
            content: [
                'Found the issue in `src/main.ts`.',
                '```ts',
                'export function add(a: number, b: number): number {',
                '  return a + b;',
                '}',
                '```',
                'Patch should keep the return type explicit.',
            ].join('\n'),
            timestamp: 1700000000200,
        },
        {
            id: 'entry-tool-2',
            role: 'tool',
            content: 'apply_patch\n*** Begin Patch\n*** Update File: /repo/src/main.ts\n- return a + b;\n+ return a + b + 0;\n*** End Patch',
            isStreaming: false,
            success: true,
            timestamp: 1700000000300,
        },
        {
            id: 'entry-assistant-2',
            role: 'assistant',
            content: 'Patch applied. Run tests to verify.',
            timestamp: 1700000000400,
        },
    ];
    return rebuildTranscriptWithCodeBlocks(entries, 88, {
        shouldFoldDiffBlock: () => false,
        shouldCollapseToolEntry: () => false,
        promoteTrailingToolEventsBeforeAssistant: false,
    });
}

function findEntryRangeIndexTs(starts: number[], ends: number[], line: number): number {
    const len = Math.min(starts.length, ends.length);
    if (len === 0) {
        return -1;
    }

    let left = 0;
    let right = len;
    while (left < right) {
        const mid = left + Math.floor((right - left) / 2);
        if ((starts[mid] ?? 0) <= line) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    if (left === 0) {
        return -1;
    }
    const idx = left - 1;
    return line <= (ends[idx] ?? -1) ? idx : -1;
}

function hitTestTs(
    layout: {
        header: any;
        messages: any;
        messagesScrollbar?: any;
        input: any;
        footer: any;
        sidebar: any;
        hasSidebar: boolean;
        overlay?: any;
    },
    col: number,
    row: number,
): { kind: string; lineOffset?: number; row?: number } {
    const contains = (rect: { x: number; y: number; width: number; height: number }) =>
        col >= rect.x
        && col < rect.x + rect.width
        && row >= rect.y
        && row < rect.y + rect.height;

    if (layout.overlay && contains(layout.overlay)) {
        return { kind: 'overlay', row: row - layout.overlay.y };
    }
    if (contains(layout.input)) {
        return { kind: 'input' };
    }
    if (contains(layout.header)) {
        return { kind: 'header' };
    }
    if (contains(layout.footer)) {
        return { kind: 'footer' };
    }
    if (layout.hasSidebar && contains(layout.sidebar)) {
        return { kind: 'sidebar', row: row - layout.sidebar.y };
    }

    if (layout.messagesScrollbar && contains(layout.messagesScrollbar)) {
        return { kind: 'scrollbar' };
    }
    if (contains(layout.messages)) {
        return { kind: 'message', lineOffset: row - layout.messages.y };
    }
    return { kind: 'none' };
}

function resolveJumpTopLineTs(
    lineCount: number,
    height: number,
    targetLine: number,
    anchorNumerator = 1,
    anchorDenominator = 3,
): number {
    const safeHeight = Math.max(1, Math.trunc(height));
    const maxTopLine = Math.max(0, lineCount - safeHeight);
    const anchorOffset = Math.floor((safeHeight * anchorNumerator) / Math.max(1, anchorDenominator));
    return Math.max(0, Math.min(maxTopLine, targetLine - anchorOffset));
}

const rustReady = rustTui.computeLayout(120, 30, 2) !== null;
const runIfRust = rustReady ? it : it.skip;

describe('rust/ts viewport contracts', () => {
    runIfRust('keeps line mapping consistent for the same transcript fixture', () => {
        const fixture = buildContractFixture();
        for (let line = 0; line < fixture.totalLines; line += 1) {
            const rustIdx = rustTui.findEntryIndex(fixture.starts, fixture.ends, line);
            const tsIdx = findEntryRangeIndexTs(fixture.starts, fixture.ends, line);
            expect(rustIdx).toBe(tsIdx);
        }
        expect(rustTui.findEntryIndex(fixture.starts, fixture.ends, fixture.totalLines + 10)).toBe(-1);
    });

    runIfRust('keeps hit-test routing consistent for the same transcript viewport', () => {
        const layout = rustTui.computeLayout(140, 30, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }
        expect(layout.messagesScrollbar).toBeTruthy();
        const scrollbarRect = layout.messagesScrollbar;
        if (!scrollbarRect) {
            return;
        }
        const points = [
            { col: layout.messages.x + 2, row: layout.messages.y + 2 },
            { col: scrollbarRect.x, row: scrollbarRect.y + 1 },
            { col: layout.input.x + 1, row: layout.input.y + 1 },
            { col: layout.header.x + 1, row: layout.header.y },
            { col: layout.footer.x + 1, row: layout.footer.y },
            { col: layout.sidebar.x + 1, row: layout.sidebar.y + 1 },
        ];

        for (const point of points) {
            const rustHit = rustTui.hitTest(140, 30, 2, null, null, point.col, point.row);
            const tsHit = hitTestTs(layout, point.col, point.row);
            expect(rustHit?.kind).toBe(tsHit.kind);
            if (tsHit.kind === 'message') {
                const lineOffset = (rustHit as { lineOffset?: number; line_offset?: number } | null)?.lineOffset
                    ?? (rustHit as { lineOffset?: number; line_offset?: number } | null)?.line_offset;
                expect(lineOffset).toBe(tsHit.lineOffset);
            }
        }
    });

    runIfRust('keeps jump topLine resolver consistent for the same transcript lines', () => {
        const fixture = buildContractFixture();
        const lineCount = fixture.totalLines;
        const viewportHeight = 6;
        const targets = [0, 4, 8, lineCount - 1];
        for (const targetLine of targets) {
            const tsTop = resolveJumpTopLineTs(lineCount, viewportHeight, targetLine, 1, 3);
            const rustQueryTop = rustTui.resolveJumpTopLine(lineCount, viewportHeight, targetLine, 1, 3);
            expect(typeof rustQueryTop).toBe('number');
            if (typeof rustQueryTop !== 'number') {
                return;
            }
            const rustTop = resolveTranscriptTopLineFromJump(lineCount, viewportHeight, targetLine, 1, 3);
            expect(rustTop).toBe(rustQueryTop);
            expect(rustTop).toBe(tsTop);
        }
    });

    runIfRust('keeps scrollbar thumb and pointer mapping consistent for the same transcript lines', () => {
        const lineCount = 120;
        const viewportHeight = 20;
        const scrollOffsets = [0, 7, 42, 88, 100];

        for (const scrollOffset of scrollOffsets) {
            const scrollbar = buildTranscriptScrollbarModel(lineCount, viewportHeight, scrollOffset);
            expect(scrollbar.visible).toBe(true);

            const pointerRow = Math.max(0, Math.floor(scrollbar.thumbTop + scrollbar.thumbHeight / 2));
            const rustQueryTop = rustTui.resolveTopLine(lineCount, viewportHeight, pointerRow, 0);
            expect(typeof rustQueryTop).toBe('number');
            if (typeof rustQueryTop !== 'number') {
                return;
            }

            const projectedTop = resolveTranscriptTopLineFromScrollbar(lineCount, viewportHeight, pointerRow, 0);
            expect(projectedTop).toBe(rustQueryTop);

            const nextScrollbar = buildTranscriptScrollbarModel(lineCount, viewportHeight, projectedTop);
            expect(Math.abs(nextScrollbar.thumbTop - scrollbar.thumbTop)).toBeLessThanOrEqual(1);
        }
    });

    runIfRust('computes overlay layout height from overlay item count', () => {
        const layout = rustTui.computeLayout(140, 30, 2, 10, 40);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }
        expect(layout.overlay).not.toBeNull();
        expect(layout.overlay?.height).toBe(11);
        expect(layout.overlay?.y).toBeGreaterThan(0);
    });

    runIfRust('keeps line mapping/hit-test/jump/scrollbar coherent for the same transcript input', () => {
        const transcript = buildTranscriptFixtureFromEntries();
        const lineCount = transcript.lines.length;
        expect(lineCount).toBeGreaterThan(0);

        const layout = rustTui.computeLayout(120, 32, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const viewportHeight = Math.max(1, layout.messages.height);
        const targetRange = transcript.entryLineRanges.find((range) => range.entryId === 'entry-assistant-1');
        expect(targetRange).toBeTruthy();
        if (!targetRange) {
            return;
        }

        const targetLine = Math.max(targetRange.startLine, Math.min(targetRange.endLine, targetRange.startLine + 2));
        const topLineFromJump = resolveTranscriptTopLineFromJump(lineCount, viewportHeight, targetLine, 1, 3);
        const rustJumpTop = rustTui.resolveJumpTopLine(lineCount, viewportHeight, targetLine, 1, 3);
        expect(topLineFromJump).toBe(rustJumpTop);

        const lineOffset = targetLine - topLineFromJump;
        expect(lineOffset).toBeGreaterThanOrEqual(0);
        expect(lineOffset).toBeLessThan(viewportHeight);

        const scrollbar = buildTranscriptScrollbarModel(lineCount, viewportHeight, topLineFromJump);
        const pointerRow = Math.max(0, Math.floor(scrollbar.thumbTop + scrollbar.thumbHeight / 2));
        const topLineFromScrollbar = resolveTranscriptTopLineFromScrollbar(lineCount, viewportHeight, pointerRow, 0);
        const rustScrollbarTop = rustTui.resolveTopLine(lineCount, viewportHeight, pointerRow, 0);
        expect(topLineFromScrollbar).toBe(rustScrollbarTop);

        const col = layout.messages.x + 1;
        const row = layout.messages.y + lineOffset;
        const rustHit = rustTui.hitTest(120, 32, 2, null, null, col, row);
        const tsHit = hitTestTs(layout, col, row);
        expect(rustHit?.kind).toBe('message');
        expect(rustHit?.kind).toBe(tsHit.kind);

        const hitOffset = (rustHit as { lineOffset?: number; line_offset?: number } | null)?.lineOffset
            ?? (rustHit as { lineOffset?: number; line_offset?: number } | null)?.line_offset
            ?? -1;
        expect(hitOffset).toBe(lineOffset);

        const projectedLine = topLineFromJump + hitOffset;
        const mappingState = {
            transcriptEntryLineRanges: transcript.entryLineRanges,
            transcriptEntryLineStarts: transcript.entryLineStarts,
            transcriptEntryLineEnds: transcript.entryLineEnds,
        };
        const mappedRange = getTranscriptEntryRangeAtLine(mappingState, projectedLine);
        expect(mappedRange?.entryId).toBe('entry-assistant-1');
        const rustRangeIndex = rustTui.findEntryIndex(transcript.entryLineStarts, transcript.entryLineEnds, projectedLine);
        const tsRangeIndex = findEntryRangeIndexTs(transcript.entryLineStarts, transcript.entryLineEnds, projectedLine);
        expect(rustRangeIndex).toBe(tsRangeIndex);
    });

    runIfRust('keeps transcript copy hotspot aligned with Rust message bounds for the same transcript input', () => {
        const transcript = buildTranscriptFixtureFromEntries();
        const lineCount = transcript.lines.length;
        const layout = rustTui.computeLayout(120, 32, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const targetRange = transcript.entryLineRanges.find((range) => range.entryId === 'entry-assistant-1');
        expect(targetRange).toBeTruthy();
        if (!targetRange) {
            return;
        }

        const targetLine = Math.max(targetRange.startLine, Math.min(targetRange.endLine, targetRange.startLine + 1));
        const topLine = resolveTranscriptTopLineFromJump(lineCount, layout.messages.height, targetLine, 1, 3);
        const lineOffset = targetLine - topLine;
        const row = layout.messages.y + lineOffset;
        const messageCol = layout.messages.x + 1;
        const geometry = projectTranscriptMouseGeometry(layout, topLine, row, messageCol);

        expect(geometry.copyHotspot.right).toBe(layout.messages.x + layout.messages.width);
        expect(geometry.copyHotspot.left).toBe(Math.max(0, geometry.copyHotspot.right - 12));

        const messageHit = rustTui.hitTest(120, 32, 2, null, null, geometry.copyHotspot.right - 1, row);
        expect(messageHit?.kind).toBe('message');

        const scrollbarHit = rustTui.hitTest(120, 32, 2, null, null, geometry.copyHotspot.right, row);
        expect(scrollbarHit?.kind).toBe('scrollbar');
    });

    runIfRust('keeps selection point projection aligned for the same press/drag inputs', () => {
        const transcript = buildTranscriptFixtureFromEntries();
        const lineCount = transcript.lines.length;
        const layout = rustTui.computeLayout(120, 32, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const targetRange = transcript.entryLineRanges.find((range) => range.entryId === 'entry-assistant-1');
        expect(targetRange).toBeTruthy();
        if (!targetRange) {
            return;
        }

        const pressLine = Math.max(targetRange.startLine, Math.min(targetRange.endLine, targetRange.startLine + 1));
        const dragLine = Math.max(pressLine, Math.min(targetRange.endLine, pressLine + 2));
        const topLine = resolveTranscriptTopLineFromJump(lineCount, layout.messages.height, pressLine, 1, 3);

        const pressRow = layout.messages.y + (pressLine - topLine);
        const dragRow = layout.messages.y + (dragLine - topLine);
        const pressCol = layout.messages.x + 4;
        const dragCol = layout.messages.x + 18;

        const projectPoint = (col: number, row: number) => {
            const rustHit = rustTui.hitTest(120, 32, 2, null, null, col, row);
            expect(rustHit?.kind).toBe('message');
            if (rustHit?.kind !== 'message') {
                return null;
            }
            const lineOffset = (rustHit as { lineOffset?: number; line_offset?: number }).lineOffset
                ?? (rustHit as { lineOffset?: number; line_offset?: number }).line_offset
                ?? -1;
            const geometry = projectTranscriptMouseGeometry(layout, topLine, row, col);
            return projectTranscriptMessagePoint(topLine, lineOffset, geometry.column, lineCount - 1);
        };

        const pressPoint = projectPoint(pressCol, pressRow);
        const dragPoint = projectPoint(dragCol, dragRow);
        expect(pressPoint).toEqual({ line: pressLine, column: pressCol - layout.messages.x });
        expect(dragPoint).toEqual({ line: dragLine, column: dragCol - layout.messages.x });
    });

    runIfRust('keeps reverse drag selection bounds coherent for the same transcript input', () => {
        const transcript = buildTranscriptFixtureFromEntries();
        const lineCount = transcript.lines.length;
        const layout = rustTui.computeLayout(120, 32, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const targetRange = transcript.entryLineRanges.find((range) => range.entryId === 'entry-assistant-1');
        expect(targetRange).toBeTruthy();
        if (!targetRange) {
            return;
        }

        const lowLine = Math.max(targetRange.startLine, Math.min(targetRange.endLine, targetRange.startLine + 1));
        const highLine = Math.max(lowLine, Math.min(targetRange.endLine, lowLine + 2));
        const topLine = resolveTranscriptTopLineFromJump(lineCount, layout.messages.height, highLine, 1, 3);

        const lowRow = layout.messages.y + (lowLine - topLine);
        const highRow = layout.messages.y + (highLine - topLine);
        const col = layout.messages.x + 10;

        const projectPoint = (row: number) => {
            const rustHit = rustTui.hitTest(120, 32, 2, null, null, col, row);
            expect(rustHit?.kind).toBe('message');
            if (rustHit?.kind !== 'message') {
                return null;
            }
            const lineOffset = (rustHit as { lineOffset?: number; line_offset?: number }).lineOffset
                ?? (rustHit as { lineOffset?: number; line_offset?: number }).line_offset
                ?? -1;
            const geometry = projectTranscriptMouseGeometry(layout, topLine, row, col);
            return projectTranscriptMessagePoint(topLine, lineOffset, geometry.column, lineCount - 1);
        };

        const anchorPoint = projectPoint(highRow);
        const dragPoint = projectPoint(lowRow);
        expect(anchorPoint).not.toBeNull();
        expect(dragPoint).not.toBeNull();
        if (!anchorPoint || !dragPoint) {
            return;
        }

        const normalizedStartLine = Math.min(anchorPoint.line, dragPoint.line);
        const normalizedEndLine = Math.max(anchorPoint.line, dragPoint.line);
        expect(normalizedStartLine).toBe(lowLine);
        expect(normalizedEndLine).toBe(highLine);
        expect(anchorPoint.column).toBe(dragPoint.column);
    });

    runIfRust('keeps selection projection stable for out-of-bounds row/col inputs', () => {
        const transcript = buildTranscriptFixtureFromEntries();
        const lineCount = transcript.lines.length;
        const layout = rustTui.computeLayout(120, 32, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const targetRange = transcript.entryLineRanges.find((range) => range.entryId === 'entry-assistant-1');
        expect(targetRange).toBeTruthy();
        if (!targetRange) {
            return;
        }

        const targetLine = Math.max(targetRange.startLine, Math.min(targetRange.endLine, targetRange.startLine + 1));
        const topLine = resolveTranscriptTopLineFromJump(lineCount, layout.messages.height, targetLine, 1, 3);

        const edgeInputs = [
            { col: layout.messages.x - 10, row: layout.messages.y - 2 },
            { col: layout.messages.x + layout.messages.width + 8, row: layout.messages.y + layout.messages.height + 3 },
            { col: layout.messages.x + 4, row: layout.messages.y + layout.messages.height + 4 },
        ];

        for (const point of edgeInputs) {
            const rustHit = rustTui.hitTest(120, 32, 2, null, null, point.col, point.row);
            expect(rustHit?.kind).not.toBe('message');

            const geometry = projectTranscriptMouseGeometry(layout, topLine, point.row, point.col);
            expect(geometry.column).toBeGreaterThanOrEqual(0);

            // Simulate selection drag projection using raw row delta and clamp into transcript bounds.
            const syntheticLineOffset = point.row - layout.messages.y;
            const projected = projectTranscriptMessagePoint(
                topLine,
                syntheticLineOffset,
                geometry.column,
                lineCount - 1,
            );
            expect(projected.line).toBeGreaterThanOrEqual(0);
            expect(projected.line).toBeLessThan(lineCount);
            expect(projected.column).toBeGreaterThanOrEqual(0);
        }
    });

    runIfRust('keeps large-transcript high-frequency drag projection stable and bounded', () => {
        const lineCount = 5000;
        const layout = rustTui.computeLayout(160, 40, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const topLine = resolveTranscriptTopLineFromJump(lineCount, layout.messages.height, 2400, 1, 3);
        const insideCol = layout.messages.x + Math.floor(layout.messages.width / 2);

        let previousLine: number | null = null;
        for (let row = layout.messages.y; row < layout.messages.y + layout.messages.height; row += 1) {
            const rustHit = rustTui.hitTest(160, 40, 2, null, null, insideCol, row);
            expect(rustHit?.kind).toBe('message');
            if (rustHit?.kind !== 'message') {
                continue;
            }
            const lineOffset = (rustHit as { lineOffset?: number; line_offset?: number }).lineOffset
                ?? (rustHit as { lineOffset?: number; line_offset?: number }).line_offset
                ?? -1;
            const geometry = projectTranscriptMouseGeometry(layout, topLine, row, insideCol);
            const point = projectTranscriptMessagePoint(topLine, lineOffset, geometry.column, lineCount - 1);
            const expectedLine = Math.max(0, Math.min(lineCount - 1, topLine + (row - layout.messages.y)));
            expect(point.line).toBe(expectedLine);
            if (previousLine != null) {
                expect(point.line).toBeGreaterThanOrEqual(previousLine);
                expect(point.line - previousLine).toBeLessThanOrEqual(1);
            }
            previousLine = point.line;
        }

        for (let index = 0; index < 200; index += 1) {
            const row = layout.messages.y - 2 + (index % (layout.messages.height + 5));
            const col = index % 3 === 0
                ? layout.messages.x - 7
                : (index % 3 === 1 ? insideCol : layout.messages.x + layout.messages.width + 7);
            const geometry = projectTranscriptMouseGeometry(layout, topLine, row, col);
            const syntheticOffset = row - layout.messages.y;
            const clampedPoint = projectTranscriptMessagePoint(
                topLine,
                syntheticOffset,
                geometry.column,
                lineCount - 1,
            );
            expect(clampedPoint.line).toBeGreaterThanOrEqual(0);
            expect(clampedPoint.line).toBeLessThan(lineCount);
            expect(clampedPoint.column).toBeGreaterThanOrEqual(0);

            const rustHit = rustTui.hitTest(160, 40, 2, null, null, col, row);
            if (rustHit?.kind === 'message') {
                const lineOffset = (rustHit as { lineOffset?: number; line_offset?: number }).lineOffset
                    ?? (rustHit as { lineOffset?: number; line_offset?: number }).line_offset
                    ?? -1;
                const point1 = projectTranscriptMessagePoint(topLine, lineOffset, geometry.column, lineCount - 1);
                const point2 = projectTranscriptMessagePoint(topLine, lineOffset, geometry.column, lineCount - 1);
                expect(point1).toEqual(point2);
            } else {
                expect(rustHit?.kind).not.toBe('message');
            }
        }
    });

    runIfRust('keeps drag selection projection stable while topLine changes during scrolling', () => {
        const lineCount = 4000;
        const layout = rustTui.computeLayout(150, 36, 2);
        expect(layout).not.toBeNull();
        if (!layout) {
            return;
        }

        const row = layout.messages.y + 6;
        const col = layout.messages.x + Math.floor(layout.messages.width / 2);
        const topLines = [900, 901, 903, 908, 915, 910, 925, 940];

        const projectedLines: number[] = [];
        for (const topLine of topLines) {
            const rustHit = rustTui.hitTest(150, 36, 2, null, null, col, row);
            expect(rustHit?.kind).toBe('message');
            const point = projectTranscriptSelectionPointFromRustHit(
                layout,
                topLine,
                row,
                col,
                rustHit,
                lineCount - 1,
            );
            expect(point).not.toBeNull();
            if (!point) {
                continue;
            }
            expect(point.line).toBeGreaterThanOrEqual(0);
            expect(point.line).toBeLessThan(lineCount);
            expect(point.column).toBeGreaterThanOrEqual(0);
            projectedLines.push(point.line);
        }

        expect(projectedLines.length).toBe(topLines.length);
        for (let index = 1; index < projectedLines.length; index += 1) {
            const lineDelta = projectedLines[index] - projectedLines[index - 1];
            const topLineDelta = topLines[index] - topLines[index - 1];
            expect(lineDelta).toBe(topLineDelta);
        }
    });

    runIfRust('keeps drag selection routing isolated when overlay opens and closes', () => {
        const lineCount = 5000;
        const itemCount = 12;
        const overlayMaxWidth = 46;
        const layoutWithOverlay = rustTui.computeLayout(150, 36, 2, itemCount, overlayMaxWidth);
        const layoutWithoutOverlay = rustTui.computeLayout(150, 36, 2);
        expect(layoutWithOverlay).not.toBeNull();
        expect(layoutWithoutOverlay).not.toBeNull();
        if (!layoutWithOverlay || !layoutWithoutOverlay || !layoutWithOverlay.overlay) {
            return;
        }

        const overlayRect = layoutWithOverlay.overlay;
        const messageRect = layoutWithOverlay.messages;
        const intersectLeft = Math.max(messageRect.x, overlayRect.x);
        const intersectRight = Math.min(messageRect.x + messageRect.width - 1, overlayRect.x + overlayRect.width - 1);
        const intersectTop = Math.max(messageRect.y, overlayRect.y);
        const intersectBottom = Math.min(messageRect.y + messageRect.height - 1, overlayRect.y + overlayRect.height - 1);
        expect(intersectLeft).toBeLessThanOrEqual(intersectRight);
        expect(intersectTop).toBeLessThanOrEqual(intersectBottom);
        if (intersectLeft > intersectRight || intersectTop > intersectBottom) {
            return;
        }

        const col = Math.min(intersectRight, intersectLeft + 1);
        const row = Math.min(intersectBottom, intersectTop + 1);
        const topLine = 2200;

        const overlayHit = rustTui.hitTest(150, 36, 2, itemCount, overlayMaxWidth, col, row);
        expect(overlayHit?.kind).toBe('overlay');
        const whileOverlay = projectTranscriptSelectionPointFromRustHit(
            layoutWithOverlay,
            topLine,
            row,
            col,
            overlayHit,
            lineCount - 1,
        );
        expect(whileOverlay).toBeNull();

        const closedHit = rustTui.hitTest(150, 36, 2, null, null, col, row);
        expect(closedHit?.kind).toBe('message');
        const afterClose = projectTranscriptSelectionPointFromRustHit(
            layoutWithoutOverlay,
            topLine,
            row,
            col,
            closedHit,
            lineCount - 1,
        );
        expect(afterClose).not.toBeNull();
        if (!afterClose) {
            return;
        }
        expect(afterClose.line).toBeGreaterThanOrEqual(0);
        expect(afterClose.line).toBeLessThan(lineCount);
        expect(afterClose.column).toBeGreaterThanOrEqual(0);
    });

    runIfRust('keeps complete overlay geometry aligned between TS helper and Rust layout for the same inputs', () => {
        const itemCount = 10;
        const overlayMaxWidth = 40;
        const layout = rustTui.computeLayout(140, 30, 2, itemCount, overlayMaxWidth);
        expect(layout).not.toBeNull();
        if (!layout || !layout.overlay) {
            return;
        }

        const overlayRect = layout.overlay;
        const visibleRows = getCompleteOverlayVisibleRows(overlayRect.height, itemCount);
        expect(visibleRows).toBe(8);

        const points = [
            { row: overlayRect.y + 2, expectedAnchorRow: 0, expectedIndex: 0 },
            { row: overlayRect.y + 5, expectedAnchorRow: 3, expectedIndex: 3 },
            { row: overlayRect.y + 9, expectedAnchorRow: 7, expectedIndex: 7 },
            { row: overlayRect.y + 10, expectedAnchorRow: null, expectedIndex: null },
        ];

        for (const point of points) {
            const rustHit = rustTui.hitTest(140, 30, 2, itemCount, overlayMaxWidth, overlayRect.x + 2, point.row);
            expect(rustHit?.kind).toBe('overlay');
            const rustOverlayRow = (rustHit as { row?: number } | null)?.row ?? -1;
            expect(rustOverlayRow).toBe(point.row - overlayRect.y);

            const projected = projectCompleteOverlayHit(
                rustOverlayRow,
                overlayRect.height,
                0,
                itemCount,
            );
            expect(projected.anchorRow).toBe(point.expectedAnchorRow);
            expect(projected.index).toBe(point.expectedIndex);
        }
    });

    runIfRust('keeps complete overlay geometry aligned after scrolling the overlay list', () => {
        const itemCount = 10;
        const overlayMaxWidth = 40;
        const scrollOffset = 2;
        const layout = rustTui.computeLayout(140, 30, 2, itemCount, overlayMaxWidth);
        expect(layout).not.toBeNull();
        if (!layout || !layout.overlay) {
            return;
        }

        const overlayRect = layout.overlay;
        const points = [
            { row: overlayRect.y + 2, expectedAnchorRow: 0, expectedIndex: 2 },
            { row: overlayRect.y + 4, expectedAnchorRow: 2, expectedIndex: 4 },
            { row: overlayRect.y + 9, expectedAnchorRow: 7, expectedIndex: 9 },
            { row: overlayRect.y + 10, expectedAnchorRow: null, expectedIndex: null },
        ];

        for (const point of points) {
            const rustHit = rustTui.hitTest(140, 30, 2, itemCount, overlayMaxWidth, overlayRect.x + 2, point.row);
            expect(rustHit?.kind).toBe('overlay');
            const rustOverlayRow = (rustHit as { row?: number } | null)?.row ?? -1;
            const projected = projectCompleteOverlayHit(
                rustOverlayRow,
                overlayRect.height,
                scrollOffset,
                itemCount,
            );
            expect(projected.anchorRow).toBe(point.expectedAnchorRow);
            expect(projected.index).toBe(point.expectedIndex);
        }
    });
});
