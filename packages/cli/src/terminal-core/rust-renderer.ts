import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { CellStyle } from './types.js';

const require = createRequire(import.meta.url);
export type RendererMode = 'rust' | 'fallback' | 'auto';

type RustCellStyle = {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
};

export interface RustMouseEvent {
    kind: 'press' | 'release' | 'move' | 'scroll_up' | 'scroll_down';
    button: 'left' | 'middle' | 'right' | 'none';
    col: number;
    row: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
    velocity: number;
}

interface RustRendererNative {
    commitState(state: RustTuiState): void;
    snapshotFrameLines?(): string[];
    snapshotFrameStyledLines?(): string[];
    clearLine(row: number): void;
    clear(): void;
    invalidate(): void;
    resize(cols: number, rows: number): void;
    stringWidth(text: string): number;
    truncateToWidth(text: string, maxWidth: number): string;
    parseMouse(seq: string): RustMouseEvent | null;
    handleMouse(seq: string, inputLines: number): boolean;
    handleMouseEvent(event: RustMouseEvent, inputLines: number): boolean;
    messageScrollBy(delta: number): void;
    messageScrollPageUp(pageSize: number): void;
    messageScrollPageDown(pageSize: number): void;
    messageScrollHome(): void;
    messageScrollToBottom(): void;
    messageScrollOffsetLines(): number;
    messageScrollStickyBottom(): boolean;
    messageScrollSetTopLine(topLine: number): void;
    messageScrollSetFromScrollbar?(lineCount: number, height: number, pointerRow: number, dragOffset: number): void;
    messageScrollJumpTo?(lineCount: number, height: number, targetLine: number, anchorNumerator: number, anchorDenominator: number): void;
    logScrollRefresh?(logLines: string[], contentWidth: number, viewportHeight: number): void;
    logScrollBy?(delta: number): void;
    logScrollPageUp?(pageSize: number): void;
    logScrollPageDown?(pageSize: number): void;
    logScrollHome?(): void;
    logScrollToBottom?(): void;
    logScrollOffsetLines?(): number;
    logScrollStickyBottom?(): boolean;
    logScrollSetTopLine?(topLine: number): void;
    logScrollSetFromScrollbar?(lineCount: number, height: number, pointerRow: number, dragOffset: number): void;
}

interface RustRendererModule {
    XqRenderer: new (cols: number, rows: number) => RustRendererNative;
    computeTuiLayout?: (cols: number, rows: number, inputLines: number, overlayItemCount?: number | null, overlayMaxWidth?: number | null) => RustTuiLayout;
    wrapTextToWidth?: (text: string, maxWidth: number) => string[];
    computeViewportVisibleRange?: (lineCount: number, topLine: number, height: number) => RustViewportRange;
    computeScrollbarThumb?: (
        contentHeight: number,
        viewportHeight: number,
        scrollTop: number,
        trackHeight: number,
    ) => RustScrollbarThumb;
    resolveViewportTopLineFromScrollbar?: (
        lineCount: number,
        height: number,
        pointerRow: number,
        dragOffset: number,
    ) => number;
    resolveViewportTopLineForJump?: (
        lineCount: number,
        height: number,
        targetLine: number,
        anchorNumerator: number,
        anchorDenominator: number,
    ) => number;
    buildEntryHeightCache?: (starts: number[], ends: number[]) => RustEntryHeightCache;
    findEntryRangeIndex?: (starts: number[], ends: number[], line: number) => number;
    hitTest?: (
        cols: number,
        rows: number,
        inputLines: number,
        overlayItemCount: number | null | undefined,
        overlayMaxWidth: number | null | undefined,
        col: number,
        row: number,
    ) => RustHitTarget;
    computeMessageHeights?: (messages: string[], contentWidth: number) => RustMessageHeights;
    findVisibleMessageRange?: (
        cumHeights: number[],
        heights: number[],
        scrollOffset: number,
        viewportHeight: number,
    ) => RustVisibleMessageRange;
    renderInputParts?: (
        parts: RustInputPartSpec[],
        cursorGrapheme: number,
        maxWidth: number,
        mode: string,
        placeholder: string,
    ) => RustInputLayout;
    isFoldedDiffMarker?: (line: string) => boolean;
    foldedMarkerHiddenCount?: (line: string) => number;
    isContextReadTool?: (toolName: string) => boolean;
    contextGroupLabel?: (reads: number) => string;
    inertialScrollDeltas?: (delta: number, steps: number) => number[];
}

interface RustLayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface RustTuiLayout {
    header: RustLayoutRect;
    messages: RustLayoutRect;
    messagesScrollbar?: RustLayoutRect | null;
    input: RustLayoutRect;
    footer: RustLayoutRect;
    sidebar: RustLayoutRect;
    hasSidebar: boolean;
    overlay?: RustLayoutRect;
}

export interface RustViewportRange {
    startLine: number;
    endLine: number;
}

export interface RustScrollbarThumb {
    visible: boolean;
    thumbTop: number;
    thumbHeight: number;
    trackHeight: number;
}

export interface RustTuiMessagePart {
    kind: string;
    content?: string;
    toolName?: string;
    status?: string;
    summary?: string;
    collapsed?: boolean;
    items?: string[];
    actionId?: string;
    stepIndex?: number;
    stepTotal?: number;
    label?: string;
}

export interface RustTuiMessage {
    id: string;
    role: string;
    parts: RustTuiMessagePart[];
    timestamp: number;
}

export interface RustTuiInputState {
    parts: RustInputPartSpec[];
    cursorGrapheme: number;
    mode: string;
}

export interface RustTuiSidebarState {
    sessionId: string;
    cwd: string;
    model: string;
    agent: string;
    mode: string;
    contextUsed: number;
    contextMax: number;
    costUsdThis: number;
    costUsdToday: number;
    todayMessages: number;
    lspLines: string[];
    dockerLines: string[];
    dockerUrl: string;
}

export interface RustTuiStatusState {
    thinking: boolean;
    text: string;
}

export interface RustTuiScrollState {
    offsetLines: number;
    maxScrollY: number;
    contentLines: number;
    stickyBottom: boolean;
    draggingScrollbar: boolean;
}

export interface RustTuiOverlayState {
    kind: string;
    items: string[];
    selectedIndex: number;
    scrollOffset: number;
    maxWidth?: number;
}

export interface RustTuiState {
    page: string;
    logLines: string[];
    messages?: RustTuiMessage[];
    input: RustTuiInputState;
    sidebar: RustTuiSidebarState;
    status: RustTuiStatusState;
    scroll: RustTuiScrollState;
    layout: RustTuiLayout;
    overlay?: RustTuiOverlayState;
    tick: number;
    blink: boolean;
}

export interface RustEntryHeightCache {
    heights: number[];
    cumHeights: number[];
    totalLines: number;
}

export interface RustHitTarget {
    kind: 'message' | 'input' | 'sidebar' | 'scrollbar' | 'header' | 'footer' | 'none' | string;
    lineOffset?: number;
    line_offset?: number;
    row?: number;
    ratio?: number;
    index?: number;
    id?: string;
    rollbackPointId?: string;
}

export interface RustMessageHeights {
    heights: number[];
    cumHeights: number[];
    totalLines: number;
}

export interface RustVisibleMessageRange {
    startIndex: number;
    startLineOffset: number;
    endIndex: number;
}

export interface RustInputPartSpec {
    kind: 'text' | 'file_pill' | 'agent_pill' | 'pasted_pill' | 'image_pill' | string;
    content?: string;
    display?: string;
    agentId?: string;
    wordCount?: number;
    index?: number;
}

export interface RustInputLayout {
    lines: string[];
    styledLines: Array<{ segments: Array<{ text: string; tone: string }> }>;
    cursorLine: number;
    cursorCol: number;
    borderTone: string;
    borderGlyph: string;
    modeChipText: string;
    modeChipTone: string;
    promptFirst: string;
    promptContinuation: string;
    contentOffsetFirst: number;
    contentOffsetContinuation: number;
    cornerTl: string;
    cornerTr: string;
    cornerBl: string;
    cornerBr: string;
    sideGlyph: string;
    isPlaceholder: boolean;
}

let cachedModule: RustRendererModule | null = null;
let moduleLoadAttempted = false;
let warnedInvalidMode = false;
let warnedFallbackMode = false;
let warnedAutoFallback = false;
const localRendererEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../renderer/index.js',
);

export function getRendererMode(): RendererMode {
    const raw = process.env.XQODER_RENDERER_MODE?.trim().toLowerCase();
    if (!raw) {
        return 'auto';
    }
    if (raw === 'rust' || raw === 'fallback' || raw === 'auto') {
        return raw;
    }
    if (!warnedInvalidMode) {
        warnedInvalidMode = true;
        process.stderr.write(`[XQoder] Invalid XQODER_RENDERER_MODE="${raw}", fallback to "auto".\n`);
    }
    return 'auto';
}

function loadRustModule(): RustRendererModule | null {
    if (moduleLoadAttempted) {
        return cachedModule;
    }
    const mode = getRendererMode();
    moduleLoadAttempted = true;
    const candidates: string[] = [];
    let usedLocalCandidate = false;

    if (mode === 'rust') {
        candidates.push('@xqoder/renderer');
    } else if (mode === 'fallback') {
        if (!warnedFallbackMode) {
            warnedFallbackMode = true;
            process.stderr.write('[XQoder] Renderer fallback mode enabled: using local rust renderer entry.\n');
        }
        candidates.push(localRendererEntry);
    } else {
        candidates.push('@xqoder/renderer', localRendererEntry);
    }

    for (const candidate of candidates) {
        try {
            const loaded = require(candidate) as RustRendererModule;
            cachedModule = loaded;
            usedLocalCandidate = mode !== 'rust' && candidate === localRendererEntry;
            break;
        } catch {
            // 继续尝试下一个候选路径
        }
    }

    if (cachedModule && mode === 'auto' && usedLocalCandidate) {
        if (!warnedAutoFallback) {
            warnedAutoFallback = true;
            process.stderr.write('[XQoder] Rust renderer auto-mode fallback: used local rust renderer entry.\n');
        }
    }

    if (!cachedModule) {
        if (mode === 'rust') {
            throw new Error('[XQoder] Rust renderer required but failed to load in mode="rust". Build/install @xqoder/renderer.');
        }

        // fallback/auto: allow run to continue only via renderer-side non-rust paths.
        process.stderr.write('[XQoder] Rust renderer module failed to load. Falling back to renderer placeholders.\n');
    }
    return cachedModule;
}

function toRustStyle(style: CellStyle): RustCellStyle {
    return {
        fg: style.fg,
        bg: style.bg,
        bold: style.bold,
        dim: style.dim,
        underline: style.underline,
    };
}

export class RustRendererAdapter {
    private readonly native: RustRendererNative | null;

    constructor(cols: number, rows: number) {
        const module = loadRustModule();
        this.native = module ? new module.XqRenderer(cols, rows) : null;
    }

    isAvailable(): boolean {
        return this.native !== null;
    }

    commitState(state: RustTuiState): void {
        this.native?.commitState(state);
    }

    snapshotFrameLines(): string[] {
        return this.native?.snapshotFrameLines?.() ?? [];
    }

    snapshotFrameStyledLines(): string[] {
        return this.native?.snapshotFrameStyledLines?.() ?? [];
    }

    clearLine(row: number): void {
        this.native?.clearLine(row);
    }

    clear(): void {
        this.native?.clear();
    }

    invalidate(): void {
        this.native?.invalidate();
    }

    resize(cols: number, rows: number): void {
        this.native?.resize(cols, rows);
    }

    stringWidth(text: string): number | null {
        if (!this.native) return null;
        return this.native.stringWidth(text);
    }

    truncateToWidth(text: string, maxWidth: number): string | null {
        if (!this.native) return null;
        return this.native.truncateToWidth(text, maxWidth);
    }

    parseMouse(seq: string): RustMouseEvent | null {
        return this.native?.parseMouse(seq) ?? null;
    }

    handleMouse(seq: string, inputLines: number): boolean {
        return this.native?.handleMouse(seq, inputLines) ?? false;
    }

    handleMouseEvent(event: RustMouseEvent, inputLines: number): boolean {
        return this.native?.handleMouseEvent(event, inputLines) ?? false;
    }

    messageScrollBy(delta: number): void {
        this.native?.messageScrollBy(delta);
    }

    messageScrollPageUp(pageSize: number): void {
        this.native?.messageScrollPageUp(pageSize);
    }

    messageScrollPageDown(pageSize: number): void {
        this.native?.messageScrollPageDown(pageSize);
    }

    messageScrollHome(): void {
        this.native?.messageScrollHome();
    }

    messageScrollToBottom(): void {
        this.native?.messageScrollToBottom();
    }

    messageScrollOffsetLines(): number {
        return this.native?.messageScrollOffsetLines() ?? 0;
    }

    messageScrollStickyBottom(): boolean {
        return this.native?.messageScrollStickyBottom() ?? true;
    }

    messageScrollSetTopLine(topLine: number): void {
        this.native?.messageScrollSetTopLine(topLine);
    }

    messageScrollSetFromScrollbar(lineCount: number, height: number, pointerRow: number, dragOffset = 0): void {
        if (this.native?.messageScrollSetFromScrollbar) {
            this.native.messageScrollSetFromScrollbar(lineCount, height, pointerRow, dragOffset);
            return;
        }
        const topLine = tryResolveViewportTopLineFromScrollbar(lineCount, height, pointerRow, dragOffset);
        if (typeof topLine === 'number') {
            this.messageScrollSetTopLine(topLine);
        }
    }

    messageScrollJumpTo(
        lineCount: number,
        height: number,
        targetLine: number,
        anchorNumerator: number,
        anchorDenominator: number,
    ): void {
        if (this.native?.messageScrollJumpTo) {
            this.native.messageScrollJumpTo(lineCount, height, targetLine, anchorNumerator, anchorDenominator);
            return;
        }
        const topLine = tryResolveViewportTopLineForJump(
            lineCount,
            height,
            targetLine,
            anchorNumerator,
            anchorDenominator,
        );
        if (typeof topLine === 'number') {
            this.messageScrollSetTopLine(topLine);
        }
    }

    logScrollRefresh(logLines: string[], contentWidth: number, viewportHeight: number): void {
        this.native?.logScrollRefresh?.(logLines, contentWidth, viewportHeight);
    }

    logScrollBy(delta: number): void {
        this.native?.logScrollBy?.(delta);
    }

    logScrollPageUp(pageSize: number): void {
        this.native?.logScrollPageUp?.(pageSize);
    }

    logScrollPageDown(pageSize: number): void {
        this.native?.logScrollPageDown?.(pageSize);
    }

    logScrollHome(): void {
        this.native?.logScrollHome?.();
    }

    logScrollToBottom(): void {
        this.native?.logScrollToBottom?.();
    }

    logScrollOffsetLines(): number {
        return this.native?.logScrollOffsetLines?.() ?? 0;
    }

    logScrollStickyBottom(): boolean {
        return this.native?.logScrollStickyBottom?.() ?? true;
    }

    logScrollSetTopLine(topLine: number): void {
        this.native?.logScrollSetTopLine?.(topLine);
    }

    logScrollSetFromScrollbar(lineCount: number, height: number, pointerRow: number, dragOffset = 0): void {
        if (this.native?.logScrollSetFromScrollbar) {
            this.native.logScrollSetFromScrollbar(lineCount, height, pointerRow, dragOffset);
            return;
        }
        const topLine = tryResolveViewportTopLineFromScrollbar(lineCount, height, pointerRow, dragOffset);
        if (typeof topLine === 'number') {
            this.logScrollSetTopLine(topLine);
        }
    }
}

export function tryComputeTuiLayout(
    cols: number,
    rows: number,
    inputLines: number,
    overlayItemCount?: number | null,
    overlayMaxWidth?: number | null,
): RustTuiLayout | null {
    const module = loadRustModule();
    if (!module?.computeTuiLayout) {
        return null;
    }
    try {
        return module.computeTuiLayout(cols, rows, inputLines, overlayItemCount ?? null, overlayMaxWidth ?? null);
    } catch {
        return null;
    }
}

export function tryWrapTextToWidth(text: string, maxWidth: number): string[] | null {
    const module = loadRustModule();
    if (!module?.wrapTextToWidth) {
        return null;
    }
    try {
        return module.wrapTextToWidth(text, maxWidth);
    } catch {
        return null;
    }
}

export function tryComputeViewportVisibleRange(lineCount: number, topLine: number, height: number): RustViewportRange | null {
    const module = loadRustModule();
    if (!module?.computeViewportVisibleRange) {
        return null;
    }
    try {
        return module.computeViewportVisibleRange(lineCount, topLine, height);
    } catch {
        return null;
    }
}

export function tryComputeScrollbarThumb(
    contentHeight: number,
    viewportHeight: number,
    scrollTop: number,
    trackHeight: number,
): RustScrollbarThumb | null {
    const module = loadRustModule();
    if (!module?.computeScrollbarThumb) {
        return null;
    }
    try {
        return module.computeScrollbarThumb(contentHeight, viewportHeight, scrollTop, trackHeight);
    } catch {
        return null;
    }
}

export function tryResolveViewportTopLineFromScrollbar(
    lineCount: number,
    height: number,
    pointerRow: number,
    dragOffset: number = 0,
): number | null {
    const module = loadRustModule();
    if (!module?.resolveViewportTopLineFromScrollbar) {
        return null;
    }
    try {
        return module.resolveViewportTopLineFromScrollbar(lineCount, height, pointerRow, dragOffset);
    } catch {
        return null;
    }
}

export function tryResolveViewportTopLineForJump(
    lineCount: number,
    height: number,
    targetLine: number,
    anchorNumerator: number,
    anchorDenominator: number,
): number | null {
    const module = loadRustModule();
    if (!module?.resolveViewportTopLineForJump) {
        return null;
    }
    try {
        return module.resolveViewportTopLineForJump(
            lineCount,
            height,
            targetLine,
            anchorNumerator,
            anchorDenominator,
        );
    } catch {
        return null;
    }
}

export function tryBuildEntryHeightCache(starts: number[], ends: number[]): RustEntryHeightCache | null {
    const module = loadRustModule();
    if (!module?.buildEntryHeightCache) {
        return null;
    }
    try {
        return module.buildEntryHeightCache(starts, ends);
    } catch {
        return null;
    }
}

export function tryFindEntryRangeIndex(starts: number[], ends: number[], line: number): number | null {
    const module = loadRustModule();
    if (!module?.findEntryRangeIndex) {
        return null;
    }
    try {
        return module.findEntryRangeIndex(starts, ends, line);
    } catch {
        return null;
    }
}

export function tryHitTest(
    cols: number,
    rows: number,
    inputLines: number,
    overlayItemCount: number | null | undefined,
    overlayMaxWidth: number | null | undefined,
    col: number,
    row: number,
): RustHitTarget | null {
    const module = loadRustModule();
    if (!module?.hitTest) {
        return null;
    }
    try {
        return module.hitTest(cols, rows, inputLines, overlayItemCount, overlayMaxWidth, col, row);
    } catch {
        return null;
    }
}

export function tryComputeMessageHeights(messages: string[], contentWidth: number): RustMessageHeights | null {
    const module = loadRustModule();
    if (!module?.computeMessageHeights) {
        return null;
    }
    try {
        return module.computeMessageHeights(messages, contentWidth);
    } catch {
        return null;
    }
}

export function tryFindVisibleMessageRange(
    cumHeights: number[],
    heights: number[],
    scrollOffset: number,
    viewportHeight: number,
): RustVisibleMessageRange | null {
    const module = loadRustModule();
    if (!module?.findVisibleMessageRange) {
        return null;
    }
    try {
        return module.findVisibleMessageRange(cumHeights, heights, scrollOffset, viewportHeight);
    } catch {
        return null;
    }
}

export function tryRenderInputParts(
    parts: RustInputPartSpec[],
    cursorGrapheme: number,
    maxWidth: number,
    mode: string,
    placeholder: string,
): RustInputLayout | null {
    const module = loadRustModule();
    if (!module?.renderInputParts) {
        return null;
    }
    try {
        return module.renderInputParts(parts, cursorGrapheme, maxWidth, mode, placeholder);
    } catch {
        return null;
    }
}

export function tryIsFoldedDiffMarker(line: string): boolean | null {
    const module = loadRustModule();
    if (!module?.isFoldedDiffMarker) return null;
    try {
        return module.isFoldedDiffMarker(line);
    } catch {
        return null;
    }
}

export function tryFoldedMarkerHiddenCount(line: string): number | null {
    const module = loadRustModule();
    if (!module?.foldedMarkerHiddenCount) return null;
    try {
        return module.foldedMarkerHiddenCount(line);
    } catch {
        return null;
    }
}

export function tryIsContextReadTool(toolName: string): boolean | null {
    const module = loadRustModule();
    if (!module?.isContextReadTool) return null;
    try {
        return module.isContextReadTool(toolName);
    } catch {
        return null;
    }
}

export function tryContextGroupLabel(reads: number): string | null {
    const module = loadRustModule();
    if (!module?.contextGroupLabel) return null;
    try {
        return module.contextGroupLabel(reads);
    } catch {
        return null;
    }
}

export function tryInertialScrollDeltas(delta: number, steps = 6): number[] | null {
    const module = loadRustModule();
    if (!module?.inertialScrollDeltas) return null;
    try {
        return module.inertialScrollDeltas(delta, steps);
    } catch {
        return null;
    }
}
