import type { TerminalAppState } from '../terminal-core/app-state.js';
import type { RustHitTarget } from '../terminal-core/rust-renderer.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import { getTranscriptEntryRangeAtLine } from '../terminal-core/transcript-line-mapping.js';

interface MouseHandlerDeps {
    dispatch: (event: TerminalCoreEvent) => void;
}

type MouseHandlerState = Pick<
TerminalAppState,
'transcriptLines' | 'transcriptCodeBlocks' | 'diffExpandedBlockIds' | 'transcriptEntryLineRanges' | 'transcriptEntryLineStarts' | 'transcriptEntryLineEnds'
>;

export class MouseHandler {
    constructor(private readonly deps: MouseHandlerDeps) {}

    resolveRollbackAction(state: MouseHandlerState, line: number, column: number): { action: 'keep' | 'revert'; rollbackPointId: string } | null {
        const safeLine = Math.max(0, Math.min(state.transcriptLines.length - 1, line));
        if (!Number.isFinite(safeLine)) {
            return null;
        }
        const lineText = state.transcriptLines[safeLine] ?? '';
        if (!lineText.includes('[✓ 保留]') && !lineText.includes('[✗ 撤销]')) {
            return null;
        }

        const range = getTranscriptEntryRangeAtLine(state, safeLine);
        if (!range?.entryId.includes(':ui:rollback-actions:')) {
            return null;
        }
        const match = range.entryId.match(/:ui:rollback-actions:([^:]+):/);
        const rollbackPointId = match?.[1];
        if (!rollbackPointId) {
            return null;
        }

        const keepIndex = lineText.indexOf('[✓ 保留]');
        const revertIndex = lineText.indexOf('[✗ 撤销]');
        if (keepIndex !== -1 && column >= keepIndex && column < keepIndex + '[✓ 保留]'.length) {
            return { action: 'keep', rollbackPointId };
        }
        if (revertIndex !== -1 && column >= revertIndex && column < revertIndex + '[✗ 撤销]'.length) {
            return { action: 'revert', rollbackPointId };
        }
        return null;
    }

    /**
     * Week5：接入 Rust `hit_test.rs` 命中结果（rustHit）
     * controller 负责把 (row/col) 交给 rustHit；mouse-handler 负责将命中结果映射为具体交互事件。
     */
    handleRustHit(
        state: MouseHandlerState,
        rustHit: RustHitTarget | null | undefined,
        line: number,
        column: number,
    ): boolean {
        if (!rustHit || typeof rustHit.kind !== 'string') {
            return false;
        }

        // 仍复用现有实现：基于 transcriptLines 做 folding/click toggle
        // 但由 hit-test 决定“这是 message 区还是别的区域”，满足接入链路要求。
        if (rustHit.kind === 'message') {
            // 对于滚动条外点击，这里不会进入 message
            return this.handleTranscriptClick(state, line) || this.resolveRollbackAction(state, line, column) != null;
        }

        // 其他命中类型在 controller 里优先处理（diff 按钮/overlay/header 等）
        return false;
    }

    handleTranscriptClick(state: MouseHandlerState, line: number): boolean {
        const safeLine = Math.max(0, Math.min(state.transcriptLines.length - 1, line));
        if (!Number.isFinite(safeLine)) {
            return false;
        }

        const lineText = state.transcriptLines[safeLine] ?? '';
        const diffBlock = state.transcriptCodeBlocks.find(
            (block) => safeLine >= block.startLine && safeLine <= block.endLine && (block.language || '').toLowerCase() === 'diff',
        );
        const onFoldedMarker = rustTui.isFoldedDiffMarker(lineText.trim());
        const blockExpanded = diffBlock ? state.diffExpandedBlockIds.includes(diffBlock.id) : false;
        if (diffBlock && (onFoldedMarker || blockExpanded)) {
            this.deps.dispatch({ type: 'diff.context.toggle', blockId: diffBlock.id });
            return true;
        }

        const range = getTranscriptEntryRangeAtLine(state, safeLine);
        if (!range?.entryId.includes(':context-group:')) {
            return false;
        }

        this.deps.dispatch({ type: 'context.group.toggle', entryId: range.entryId });
        return true;
    }
}
