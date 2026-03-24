import { copyTarget, copyViewportSelection, getTranscriptCopyHotspotTarget } from '../terminal-core/copy-action.js';
import { getClipboardService } from '../terminal-core/clipboard.js';
import { toZeroBasedMousePoint } from '../terminal-core/mouse-geometry.js';
import { createRustLayoutHitTestQuery } from '../terminal-core/rust-layout-hit-test-query.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { createSelectionAnchorLifecycle } from '../terminal-core/selection-anchor-lifecycle.js';
import { projectTranscriptMouseGeometry, projectTranscriptSelectionPointFromRustHit } from '../terminal-core/transcript-mouse-geometry.js';
import { createTranscriptSelectionEvents } from '../terminal-core/transcript-selection-events.js';
import { MouseHandler } from './mouse-handler.js';
import { keepRollbackPointUi, restoreRollbackPointUi } from '../commands/rollbacks.js';

interface MouseTranscriptControllerDeps {
    dispatch: (event: unknown) => void;
    renderNow: () => Promise<unknown>;
    stdout: NodeJS.WriteStream;
}

function toRustMouseEvent(input: Extract<TerminalInputEvent, { type: 'mouse' }>) {
    if (input.kind === 'scroll') {
        return null;
    }
    const point = toZeroBasedMousePoint(input);
    const kind = input.kind === 'drag' ? 'move' : input.kind;
    const button = input.button === 'left' || input.button === 'middle' || input.button === 'right'
        ? input.button
        : 'none';
    return {
        kind,
        button,
        col: point.col,
        row: point.row,
        shift: Boolean(input.shift),
        alt: Boolean(input.alt),
        ctrl: Boolean(input.ctrl),
        velocity: 0,
    } as const;
}

export class MouseTranscriptController {
    private readonly selectionAnchor = createSelectionAnchorLifecycle();
    private readonly mouseHandler: MouseHandler;

    constructor(private readonly deps: MouseTranscriptControllerDeps) {
        this.mouseHandler = new MouseHandler({
            dispatch: (event) => this.deps.dispatch(event),
        });
    }

    private finalizeSelectionRelease(st: any): void {
        const selection = st.viewport?.selectedRange ?? null;
        if (selection) {
            const focusLine = typeof selection.end?.line === 'number' ? selection.end.line : null;
            if (focusLine != null) {
                this.deps.dispatch({ type: 'viewport.focusLine.set', line: focusLine });
            }
            const copied = copyViewportSelection(
                st.transcriptLines,
                selection,
                getClipboardService(),
                (event) => this.deps.dispatch(event),
                () => this.deps.renderNow(),
                this.deps.stdout,
                { ttl: 3000, clearSelectionOnEmpty: true },
            );
            if (copied) {
                // Selection copy uses toast; clear stale notice to avoid mixed feedback channels.
                this.deps.dispatch({ type: 'notice.set', notice: undefined });
            }
        }
        this.selectionAnchor.release();
    }

    handle(input: TerminalInputEvent, st: any): boolean {
        const isChatPage = st.page === 'chat';
        const activeViewport = isChatPage ? st.viewport : st.logViewport;
        const baseTopLine = activeViewport.scrollOffset;
        const rustQuery = createRustLayoutHitTestQuery(st);
        if (input.type === 'mouse') {
            const rustMouseEvent = toRustMouseEvent(input);
            if (rustMouseEvent && rustTui.handleMouseEvent(rustMouseEvent, rustQuery.inputLines)) {
                this.selectionAnchor.clear();
                this.deps.dispatch({ type: isChatPage ? 'viewport.sync' : 'logViewport.sync' });
                return true;
            }
        }

        if (input.type === 'mouse' && input.kind === 'press' && input.button === 'left') {
            const point = toZeroBasedMousePoint(input);
            const row = point.row;
            const col = point.col;
            const layout = rustQuery.computeBaseLayout();
            if (!layout) return false;

            const rustHit = rustQuery.hitTest(col, row);
            const transcriptPointer = projectTranscriptMouseGeometry(
                layout,
                baseTopLine,
                row,
                col,
            );

            if (rustHit?.kind === 'scrollbar') {
                return true;
            }

            if (isChatPage && row >= transcriptPointer.transcriptStartRow && col >= transcriptPointer.copyHotspot.left && col < transcriptPointer.copyHotspot.right) {
                const lineIndex = transcriptPointer.lineIndex;
                if (lineIndex == null) {
                    return true;
                }
                const target = getTranscriptCopyHotspotTarget(st, lineIndex);
                if (target) {
                    void copyTarget(
                        st,
                        target,
                        getClipboardService(),
                        (event) => this.deps.dispatch(event),
                        this.deps.stdout,
                    ).then(() => this.deps.renderNow());
                }
                return true;
            }

            if (rustHit?.kind === 'workflow_step') {
                const stepText = rustHit.id ?? '';
                this.deps.dispatch({ type: 'notice.set', notice: `Workflow step: ${stepText}` });
                this.deps.renderNow();
                return true;
            }

            if (rustHit?.kind === 'diff_confirm') {
                const rollbackPointId = rustHit.id ?? '';
                if (typeof rollbackPointId === 'string' && rollbackPointId.length > 0) {
                    try {
                        keepRollbackPointUi(rollbackPointId);
                        const sessionId = st.activeSessionId ?? 'tui-session';
                        const timestamp = Date.now();
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.called',
                            sessionId,
                            timestamp,
                            tool: 'keep_rollback_point',
                            args: { rollbackPointId },
                        });
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.output',
                            sessionId,
                            timestamp: timestamp + 1,
                            tool: 'keep_rollback_point',
                            output: `已保留回滚点 ${rollbackPointId}（不再可撤销）`,
                        });
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.completed',
                            sessionId,
                            timestamp: timestamp + 2,
                            tool: 'keep_rollback_point',
                            success: true,
                            metadata: { rollbackPointId, changeType: 'keep' },
                        });
                    } catch (err) {
                        this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                        this.deps.renderNow();
                        return true;
                    }
                }
                this.deps.dispatch({ type: 'notice.set', notice: '已保留改动' });
                this.deps.renderNow();
                return true;
            }

            if (rustHit?.kind === 'diff_revert') {
                const rollbackPointId = rustHit.id ?? rustHit.rollbackPointId;
                if (typeof rollbackPointId === 'string' && rollbackPointId.length > 0) {
                    try {
                        const restored = restoreRollbackPointUi(rollbackPointId);
                        const sessionId = st.activeSessionId ?? 'tui-session';
                        const timestamp = Date.now();
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.called',
                            sessionId,
                            timestamp,
                            tool: 'restore_rollback_point',
                            args: { rollbackPointId },
                        });
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.output',
                            sessionId,
                            timestamp: timestamp + 1,
                            tool: 'restore_rollback_point',
                            output: `已恢复回滚点 ${restored.id}，文件: ${restored.filePaths.join(', ')}`,
                        });
                        this.deps.dispatch({
                            type: 'ui.tool.feedback.completed',
                            sessionId,
                            timestamp: timestamp + 2,
                            tool: 'restore_rollback_point',
                            success: true,
                            metadata: { rollbackPointId: restored.id, filePaths: restored.filePaths, changeType: 'restore' },
                        });
                        this.deps.dispatch({ type: 'notice.set', notice: `已撤销改动（${restored.filePaths.length} files）` });
                    } catch (err) {
                        this.deps.dispatch({ type: 'notice.set', notice: err instanceof Error ? err.message : String(err) });
                    }
                    this.deps.renderNow();
                    return true;
                }
            }

            const isMessageHit = rustHit?.kind === 'message';
            if (isMessageHit) {
                if (!isChatPage) {
                    return true;
                }
                const point = projectTranscriptSelectionPointFromRustHit(
                    layout,
                    baseTopLine,
                    row,
                    col,
                    rustHit,
                    st.transcriptLines.length - 1,
                );
                if (!point) {
                    return true;
                }
                const line = point.line;
                const column = point.column;
                if (this.mouseHandler.handleRustHit(st, rustHit, line, column)) {
                    return true;
                }
                const anchor = this.selectionAnchor.press({ line, column });
                for (const event of createTranscriptSelectionEvents(
                    anchor,
                    anchor,
                )) {
                    this.deps.dispatch(event);
                }
                return true;
            }

            return true;
        }

        if (input.type === 'mouse' && input.kind === 'drag' && input.button === 'left' && this.selectionAnchor.has()) {
            const layout = rustQuery.computeBaseLayout();
            if (!layout) return true;
            const point = toZeroBasedMousePoint(input);
            const row = point.row;
            const col = point.col;
            const rustHit = rustQuery.hitTest(col, row);
            const isMessageHit = rustHit?.kind === 'message';
            if (isMessageHit) {
                if (!isChatPage) {
                    return true;
                }
                const point = projectTranscriptSelectionPointFromRustHit(
                    layout,
                    baseTopLine,
                    row,
                    col,
                    rustHit,
                    st.transcriptLines.length - 1,
                );
                if (!point) {
                    return true;
                }
                const dragRange = this.selectionAnchor.drag(point);
                if (!dragRange) {
                    return true;
                }
                for (const event of createTranscriptSelectionEvents(
                    dragRange.start,
                    dragRange.end,
                )) {
                    this.deps.dispatch(event);
                }
            }
            return true;
        }

        if (input.type === 'mouse' && input.kind === 'release' && input.button === 'left') {
            this.finalizeSelectionRelease(st);
            return true;
        }

        return false;
    }

    clearSelectionAnchor(): void {
        this.selectionAnchor.clear();
    }
}
