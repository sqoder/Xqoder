import {
    tryBuildEntryHeightCache,
    tryComputeMessageHeights,
    tryComputeScrollbarThumb,
    tryComputeTuiLayout,
    tryComputeViewportVisibleRange,
    tryFindEntryRangeIndex,
    tryFindVisibleMessageRange,
    tryHitTest,
    tryInertialScrollDeltas,
    tryIsContextReadTool,
    tryContextGroupLabel,
    tryIsFoldedDiffMarker,
    tryFoldedMarkerHiddenCount,
    tryRenderInputParts,
    tryResolveViewportTopLineFromScrollbar,
    tryResolveViewportTopLineForJump,
    tryWrapTextToWidth,
    type RustMouseEvent,
    type RustInputLayout,
    type RustInputPartSpec,
    type RustTuiMessage,
    type RustTuiMessagePart,
    type RustTuiLayout,
    type RustTuiState,
} from './rust-renderer.js';
import { RustRendererAdapter } from './rust-renderer.js';

export interface RustMessageViewportState {
    scrollOffset: number;
    isFollowingBottom: boolean;
}

export interface RustLogViewportState {
    scrollOffset: number;
    isFollowingBottom: boolean;
}

export type MessageViewportIntent =
    | { kind: 'delta'; delta: number }
    | { kind: 'page'; direction: 'up' | 'down'; pageSize: number }
    | { kind: 'home' }
    | { kind: 'end' }
    | { kind: 'set-top-line'; topLine: number }
    | { kind: 'scrollbar'; lineCount: number; height: number; pointerRow: number; dragOffset?: number }
    | { kind: 'jump'; lineCount: number; height: number; targetLine: number; anchorNumerator?: number; anchorDenominator?: number };

export type LogViewportIntent =
    | { kind: 'delta'; delta: number }
    | { kind: 'page'; direction: 'up' | 'down'; pageSize: number }
    | { kind: 'home' }
    | { kind: 'end' }
    | { kind: 'set-top-line'; topLine: number }
    | { kind: 'scrollbar'; lineCount: number; height: number; pointerRow: number; dragOffset?: number };

class RustTuiController {
    private renderer: RustRendererAdapter | null = null;
    private rustMessageCache = new WeakMap<ReadonlyArray<RustTuiMessage>, RustTuiMessage[]>();
    private lastCommittedMessages: ReadonlyArray<RustTuiMessage> | null = null;

    enterTerminalMode(stdout: NodeJS.WriteStream = process.stdout): void {
        const cols = stdout.columns ?? 80;
        const rows = stdout.rows ?? 24;
        this.renderer = new RustRendererAdapter(cols, rows);

        // 仅保留基础的模式切换，避免与 Rust 渲染器的绘图逻辑冲突
        stdout.write('\x1b[?1049h'); // 进入备用屏幕
        stdout.write('\x1b[?2004h'); // 开启粘贴模式
        stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h'); // 开启鼠标追踪
    }

    leaveTerminalMode(stdout: NodeJS.WriteStream = process.stdout): void {
        stdout.write('\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l');
        stdout.write('\x1b[?2004l');
        stdout.write('\x1b[0m\x1b[?1049l'); // 退出备用屏幕并重置样式
    }

    computeLayout(
        cols: number,
        rows: number,
        inputLines: number,
        overlayItemCount?: number | null,
        overlayMaxWidth?: number | null,
    ): RustTuiLayout | null {
        return tryComputeTuiLayout(cols, rows, inputLines, overlayItemCount, overlayMaxWidth);
    }

    wrapText(text: string, maxWidth: number): string[] | null {
        return tryWrapTextToWidth(text, maxWidth);
    }

    computeViewportRange(lineCount: number, topLine: number, height: number) {
        return tryComputeViewportVisibleRange(lineCount, topLine, height);
    }

    computeScrollbar(contentHeight: number, viewportHeight: number, scrollTop: number, trackHeight: number) {
        return tryComputeScrollbarThumb(contentHeight, viewportHeight, scrollTop, trackHeight);
    }

    resolveTopLine(lineCount: number, height: number, pointerRow: number, dragOffset = 0): number | null {
        return tryResolveViewportTopLineFromScrollbar(lineCount, height, pointerRow, dragOffset);
    }

    resolveJumpTopLine(
        lineCount: number,
        height: number,
        targetLine: number,
        anchorNumerator = 1,
        anchorDenominator = 3,
    ): number | null {
        return tryResolveViewportTopLineForJump(
            lineCount,
            height,
            targetLine,
            anchorNumerator,
            anchorDenominator,
        );
    }

    buildEntryCache(starts: number[], ends: number[]) {
        return tryBuildEntryHeightCache(starts, ends);
    }

    findEntryIndex(starts: number[], ends: number[], line: number): number {
        const rangeIndex = tryFindEntryRangeIndex(starts, ends, line);
        return typeof rangeIndex === 'number' ? rangeIndex : -1;
    }

    hitTest(cols: number, rows: number, inputLines: number, overlayItemCount: number | null | undefined, overlayMaxWidth: number | null | undefined, col: number, row: number) {
        return tryHitTest(cols, rows, inputLines, overlayItemCount, overlayMaxWidth, col, row);
    }

    computeMessageHeights(messages: string[], contentWidth: number) {
        return tryComputeMessageHeights(messages, contentWidth);
    }

    findVisibleMessageRange(cumHeights: number[], heights: number[], scrollOffset: number, viewportHeight: number) {
        return tryFindVisibleMessageRange(cumHeights, heights, scrollOffset, viewportHeight);
    }

    renderInput(parts: RustInputPartSpec[], cursorGrapheme: number, maxWidth: number, mode: string, placeholder: string): RustInputLayout | null {
        return tryRenderInputParts(parts, cursorGrapheme, maxWidth, mode, placeholder);
    }

    isFoldedDiffMarker(line: string): boolean {
        return tryIsFoldedDiffMarker(line) ?? false;
    }

    foldedMarkerHiddenCount(line: string): number {
        return tryFoldedMarkerHiddenCount(line) ?? 0;
    }

    isContextReadTool(toolName: string): boolean {
        return tryIsContextReadTool(toolName) ?? false;
    }

    contextGroupLabel(reads: number): string {
        return tryContextGroupLabel(reads) ?? `Gathered context · ${Math.max(1, reads)} reads`;
    }

    inertialScrollDeltas(delta: number, steps = 6): number[] {
        return tryInertialScrollDeltas(delta, steps) ?? [delta];
    }

    // --- Rust 单一真相：消息区滚动 ---
    // 这些方法由 Rust 内部保存消息区 scroll 状态。
    messageScrollBy(delta: number): void {
        this.renderer?.messageScrollBy(delta);
    }

    messageScrollPageUp(pageSize: number): void {
        this.renderer?.messageScrollPageUp(pageSize);
    }

    messageScrollPageDown(pageSize: number): void {
        this.renderer?.messageScrollPageDown(pageSize);
    }

    messageScrollHome(): void {
        this.renderer?.messageScrollHome();
    }

    messageScrollToBottom(): void {
        this.renderer?.messageScrollToBottom();
    }

    messageScrollOffsetLines(): number {
        return this.renderer?.messageScrollOffsetLines() ?? 0;
    }

    messageScrollStickyBottom(): boolean {
        return this.renderer?.messageScrollStickyBottom() ?? true;
    }

    messageScrollSetTopLine(topLine: number): void {
        this.renderer?.messageScrollSetTopLine(Math.max(0, Math.trunc(topLine)));
    }

    applyMessageViewportIntent(intent: MessageViewportIntent): void {
        switch (intent.kind) {
            case 'delta':
                this.messageScrollBy(intent.delta);
                return;
            case 'page':
                if (intent.direction === 'up') {
                    this.messageScrollPageUp(intent.pageSize);
                } else {
                    this.messageScrollPageDown(intent.pageSize);
                }
                return;
            case 'home':
                this.messageScrollHome();
                return;
            case 'end':
                this.messageScrollToBottom();
                return;
            case 'set-top-line':
                this.messageScrollSetTopLine(intent.topLine);
                return;
            case 'scrollbar':
                this.renderer?.messageScrollSetFromScrollbar(
                    intent.lineCount,
                    intent.height,
                    intent.pointerRow,
                    intent.dragOffset ?? 0,
                );
                return;
            case 'jump':
                this.renderer?.messageScrollJumpTo(
                    intent.lineCount,
                    intent.height,
                    intent.targetLine,
                    intent.anchorNumerator ?? 1,
                    intent.anchorDenominator ?? 3,
                );
                return;
        }
    }

    queryMessageViewport(): RustMessageViewportState {
        return {
            scrollOffset: Math.max(0, Math.trunc(this.messageScrollOffsetLines())),
            isFollowingBottom: this.messageScrollStickyBottom(),
        };
    }

    handleMouse(seq: string, inputLines: number): boolean {
        return this.renderer?.handleMouse(seq, inputLines) ?? false;
    }

    handleMouseEvent(event: RustMouseEvent, inputLines: number): boolean {
        return this.renderer?.handleMouseEvent(event, inputLines) ?? false;
    }

    refreshLogViewport(logLines: string[], contentWidth: number, viewportHeight: number): void {
        this.renderer?.logScrollRefresh(logLines, Math.max(1, Math.trunc(contentWidth)), Math.max(1, Math.trunc(viewportHeight)));
    }

    logScrollBy(delta: number): void {
        this.renderer?.logScrollBy(delta);
    }

    logScrollPageUp(pageSize: number): void {
        this.renderer?.logScrollPageUp(pageSize);
    }

    logScrollPageDown(pageSize: number): void {
        this.renderer?.logScrollPageDown(pageSize);
    }

    logScrollHome(): void {
        this.renderer?.logScrollHome();
    }

    logScrollToBottom(): void {
        this.renderer?.logScrollToBottom();
    }

    logScrollOffsetLines(): number {
        return this.renderer?.logScrollOffsetLines() ?? 0;
    }

    logScrollStickyBottom(): boolean {
        return this.renderer?.logScrollStickyBottom() ?? true;
    }

    logScrollSetTopLine(topLine: number): void {
        this.renderer?.logScrollSetTopLine(Math.max(0, Math.trunc(topLine)));
    }

    applyLogViewportIntent(intent: LogViewportIntent): void {
        switch (intent.kind) {
            case 'delta':
                this.logScrollBy(intent.delta);
                return;
            case 'page':
                if (intent.direction === 'up') {
                    this.logScrollPageUp(intent.pageSize);
                } else {
                    this.logScrollPageDown(intent.pageSize);
                }
                return;
            case 'home':
                this.logScrollHome();
                return;
            case 'end':
                this.logScrollToBottom();
                return;
            case 'set-top-line':
                this.logScrollSetTopLine(intent.topLine);
                return;
            case 'scrollbar':
                this.renderer?.logScrollSetFromScrollbar(
                    intent.lineCount,
                    intent.height,
                    intent.pointerRow,
                    intent.dragOffset ?? 0,
                );
                return;
        }
    }

    queryLogViewport(): RustLogViewportState {
        return {
            scrollOffset: Math.max(0, Math.trunc(this.logScrollOffsetLines())),
            isFollowingBottom: this.logScrollStickyBottom(),
        };
    }

    // --- 新的全量渲染接口 ---

    commitState(state: RustTuiState): void {
        const rendererMissing = !this.renderer;
        const rustState = this.mapToRustState(state, rendererMissing);
        if (rendererMissing) {
            const inferredSize = inferTerminalSizeFromLayout(rustState.layout);
            const cols = inferredSize.cols ?? process.stdout.columns ?? 80;
            const rows = inferredSize.rows ?? process.stdout.rows ?? 24;
            this.renderer = new RustRendererAdapter(cols, rows);
        }
        this.renderer?.commitState(rustState);
    }

    private mapToRustState(state: RustTuiState, forceFullMessages = false): RustTuiState {
        const sourceMessages = state.messages;
        const shouldSendMessages =
            forceFullMessages
            || !sourceMessages
            || this.lastCommittedMessages !== sourceMessages;
        const mappedMessages = shouldSendMessages
            ? this.mapMessages(sourceMessages)
            : undefined;
        if (sourceMessages && shouldSendMessages) {
            this.lastCommittedMessages = sourceMessages;
        }
        // NAPI 生成的 JS 侧字段是 camelCase（见 packages/renderer/index.d.ts）
        // 这里保持 camelCase，避免 runtime 侧出现字段缺失。
        return {
            page: state.page ?? 'chat',
            logLines: state.logLines ?? [],
            messages: mappedMessages,
            input: {
                parts: state.input?.parts?.map((part) => ({
                    kind: part.kind,
                    content: part.content,
                    display: part.display,
                    agentId: part.agentId,
                    wordCount: part.wordCount,
                    index: part.index,
                })) ?? [],
                cursorGrapheme: state.input?.cursorGrapheme ?? 0,
                mode: state.input?.mode ?? 'normal',
            },
            sidebar: {
                sessionId: state.sidebar?.sessionId ?? '',
                cwd: state.sidebar?.cwd ?? '',
                model: state.sidebar?.model ?? '',
                agent: state.sidebar?.agent ?? '',
                mode: state.sidebar?.mode ?? '',
                contextUsed: state.sidebar?.contextUsed ?? 0,
                contextMax: state.sidebar?.contextMax ?? 0,
                costUsdThis: state.sidebar?.costUsdThis ?? 0,
                costUsdToday: state.sidebar?.costUsdToday ?? 0,
                todayMessages: state.sidebar?.todayMessages ?? 0,
                lspLines: state.sidebar?.lspLines ?? [],
                dockerLines: state.sidebar?.dockerLines ?? [],
                dockerUrl: state.sidebar?.dockerUrl ?? '',
            },
            status: {
                thinking: !!state.status?.thinking,
                text: state.status?.text ?? '',
            },
            scroll: {
                offsetLines: state.scroll?.offsetLines ?? 0,
                maxScrollY: state.scroll?.maxScrollY ?? 0,
                contentLines: state.scroll?.contentLines ?? 0,
                stickyBottom: !!state.scroll?.stickyBottom,
                draggingScrollbar: !!state.scroll?.draggingScrollbar,
            },
            layout: state.layout,
            overlay: state.overlay
                ? {
                    kind: state.overlay.kind,
                    items: state.overlay.items ?? [],
                    selectedIndex: state.overlay.selectedIndex ?? 0,
                    scrollOffset: state.overlay.scrollOffset ?? 0,
                    maxWidth: state.overlay.maxWidth,
                }
                : undefined,
            tick: state.tick ?? 0,
            blink: state.blink ?? false,
        };
    }

    private mapMessages(messages: ReadonlyArray<RustTuiMessage> | undefined): RustTuiMessage[] {
        if (!messages) {
            return [];
        }
        const cached = this.rustMessageCache.get(messages);
        if (cached) {
            return cached;
        }
        const mapped = messages.map((message) => ({
            id: message.id,
            role: message.role,
            timestamp: message.timestamp,
            parts: (message.parts ?? []).map((part): RustTuiMessagePart => ({
                kind: part.kind,
                content: part.content,
                toolName: part.toolName,
                status: part.status,
                summary: part.summary,
                collapsed: part.collapsed,
                items: part.items,
                actionId: part.actionId,
                stepIndex: part.stepIndex,
                stepTotal: part.stepTotal,
                label: part.label,
            })),
        }));
        this.rustMessageCache.set(messages, mapped);
        return mapped;
    }
}

export const rustTui = new RustTuiController();

function inferTerminalSizeFromLayout(layout: RustTuiLayout): { cols: number; rows: number } {
    const rects = [
        layout.header,
        layout.messages,
        layout.messagesScrollbar ?? null,
        layout.input,
        layout.footer,
        layout.sidebar,
        layout.overlay ?? null,
    ].filter((rect): rect is NonNullable<typeof rect> => rect !== null);

    const cols = rects.reduce((max, rect) => Math.max(max, rect.x + rect.width), 0);
    const rows = rects.reduce((max, rect) => Math.max(max, rect.y + rect.height), 0);

    return {
        cols: Math.max(1, cols),
        rows: Math.max(1, rows),
    };
}
