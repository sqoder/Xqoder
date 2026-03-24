/**
 * XQoder Renderer Bridge (TS侧唯一职责：状态映射 + Rust 提交)
 *
 * 边界约束：
 * - 仅负责把 `TerminalAppState` 映射为 `rustTui.commitState` 所需的 TUI 状态协议
 * - 不承载任何渲染算法（布局/绘制/命中/滚动/文本测量/滚动条 thumb 等全部由 Rust 单一真相计算）
 * - `XQODER_RENDERER_MODE=rust|fallback|auto` 控制 Rust 渲染器的加载/退化策略；fallback 必须显式告警
 */

import { rustTui } from './rust-tui.js';
import type {
    OverlayCommandItem,
    OverlayCompleteItem,
    OverlayFilepickerItem,
    OverlayHelpItem,
    OverlayModelItem,
    OverlaySessionItem,
    OverlayThemeItem,
    TerminalAppState,
    TerminalTranscriptEntry,
} from './app-state.js';
import { buildEditorInputPartModel } from './input-parts.js';
import { estimateInputLinesForLayout } from './input-layout.js';
import { buildFallbackLayout } from './renderer-fallback-layout.js';
import {
    getRendererMode,
    type RustTuiMessage,
    type RustTuiMessagePart,
    type RustTuiOverlayState,
    type RustTuiState,
} from './rust-renderer.js';

let warnedLayoutFallback = false;
const transcriptMessageCache = new WeakMap<ReadonlyArray<TerminalTranscriptEntry>, RustTuiMessage[]>();

type RenderableOverlayState = Exclude<NonNullable<TerminalAppState['overlay']>, { type: 'arguments' }>;
type InitOverlayItem = Extract<RenderableOverlayState, { type: 'init' }>['items'][number];
type RenderableOverlayItem =
    | OverlaySessionItem
    | OverlayModelItem
    | OverlayCommandItem
    | OverlayFilepickerItem
    | OverlayCompleteItem
    | OverlayThemeItem
    | OverlayHelpItem
    | InitOverlayItem;
type TerminalAppRenderState = TerminalAppState & { tick?: number; blink?: boolean };

function mapTranscriptEntryToRustMessage(entry: TerminalTranscriptEntry): RustTuiMessage {
    // 让 Rust 使用与 transcript-blocks 相同的“角色 header 规则”：
    // tool/system 在 transcript-blocks 中不输出 header 行。
    // 因此这里不要把 tool/system 统一映射到 assistant。
    const role = entry.role;
    if (entry.id === '[:ui:rollback-actions:]') {
        const rollbackPointId = entry.rollbackPointId ?? '';
        return {
            id: entry.id,
            role,
            timestamp: entry.timestamp ?? Date.now(),
            parts: [
                { kind: 'diff_actions', actionId: rollbackPointId } as const,
            ],
        };
    }
    if (entry.role === 'tool' && entry.id.includes(':tool:workflow:')) {
        const lines = String(entry.content ?? '').split('\n');
        const parts: RustTuiMessagePart[] = [];
        for (const line of lines) {
            const trimmed = line.trimEnd();
            if (!trimmed) continue;
            if (trimmed.startsWith('▏')) {
                const m = trimmed.match(/^▏(?<glyph>.)\s*Step\s+(?<i>\d+)\/(?<t>\d+)\s+(?<label>.*?)(\s+\[(?<badge>done|pending|···|err)\])?\s*$/u);
                if (!m?.groups) {
                    parts.push({ kind: 'text', content: trimmed });
                    continue;
                }
                const i = Number(m.groups.i);
                const t = Number(m.groups.t);
                const badge = m.groups.badge ?? '';
                const status =
                    badge === 'done' ? 'done' :
                        badge === 'err' ? 'error' :
                            badge === '···' ? 'running' :
                                'pending';
                parts.push({
                    kind: 'workflow_progress',
                    stepIndex: Number.isFinite(i) ? i : 0,
                    stepTotal: Number.isFinite(t) ? t : 0,
                    label: (m.groups.label ?? '').trim(),
                    status,
                    actionId: `${i}/${t} ${(m.groups.label ?? '').trim()}`,
                });
            } else {
                parts.push({ kind: 'text', content: trimmed });
            }
        }
        return {
            id: entry.id,
            role,
            timestamp: entry.timestamp ?? Date.now(),
            parts: parts.length > 0 ? parts : [{ kind: 'text', content: entry.content } as const],
        };
    }
    return {
        id: entry.id,
        role,
        timestamp: entry.timestamp ?? Date.now(),
        parts: [
            { kind: 'text', content: entry.content } as const
        ]
    };
}

function mapTranscriptEntriesToRustMessages(entries: ReadonlyArray<TerminalTranscriptEntry>): RustTuiMessage[] {
    const cached = transcriptMessageCache.get(entries);
    if (cached) {
        return cached;
    }
    const mapped = entries.map(mapTranscriptEntryToRustMessage);
    transcriptMessageCache.set(entries, mapped);
    return mapped;
}

function mapOverlayItemToLine(item: RenderableOverlayItem): string {
    if ('description' in item && 'key' in item) {
        return `${item.key}: ${item.description}`;
    }
    if ('title' in item) {
        return item.title;
    }
    if ('path' in item) {
        return item.label;
    }
    return item.label;
}

function mapOverlayToRustState(overlay: RenderableOverlayState): RustTuiOverlayState {
    if (overlay.type === 'commands') {
        return {
            kind: overlay.type,
            items: overlay.items.map((item) => {
                const pro = item.pro ? '[Pro] ' : '';
                const desc = item.description ? ` - ${item.description}` : '';
                return `${pro}${item.label}${desc}`;
            }),
            selectedIndex: overlay.selectedIndex,
            scrollOffset: 0,
            maxWidth: undefined,
        };
    }

    if (overlay.type === 'complete') {
        return {
            kind: overlay.type,
            items: overlay.items.map(mapOverlayItemToLine),
            selectedIndex: overlay.selectedIndex,
            scrollOffset: overlay.scrollOffset,
            maxWidth: undefined,
        };
    }

    return {
        kind: overlay.type,
        items: overlay.items.map(mapOverlayItemToLine),
        selectedIndex: overlay.selectedIndex,
        scrollOffset: 0,
        maxWidth: undefined,
    };
}

/**
 * 将核心业务状态 TerminalAppState 映射为 TUI 通信协议 TUIState
 */
export function mapAppStateToTUIState(state: TerminalAppRenderState): RustTuiState {
    const inputPartModel = buildEditorInputPartModel(state.editor, state.interactionMode);
    const cols = state.size.width;
    const rows = state.size.height;
    const inputLines = estimateInputLinesForLayout(state.editor.value);
    const mode = getRendererMode();
    const layout = rustTui.computeLayout(cols, rows, inputLines);
    const resolvedLayout = (() => {
        if (layout) return layout;
        // mode="rust" 表示 Rust 是唯一渲染真相；如果布局能力不可用就直接失败。
        if (mode === 'rust') {
            throw new Error('[XQoder] Rust renderer is required (mode="rust") but computeLayout returned null.');
        }
        if (!warnedLayoutFallback) {
            warnedLayoutFallback = true;
            process.stderr.write(`[XQoder] Renderer layout fallback active (mode=${mode}).\n`);
        }
        return buildFallbackLayout(cols, rows);
    })();
    const activeViewport = state.page === 'logs' ? state.logViewport : state.viewport;
    const scrollProjection = {
        scrollOffset: activeViewport.scrollOffset,
        isFollowingBottom: activeViewport.isFollowingBottom,
    };
    const rendererStatus = state.rendererStatus;
    const overlay = state.overlay;
    const overlayState = overlay && overlay.type !== 'arguments'
        ? mapOverlayToRustState(overlay)
        : undefined;
    
    return {
        page: state.page,
        logLines: state.logLines,
        messages: mapTranscriptEntriesToRustMessages(state.transcriptEntries),
        input: {
            parts: inputPartModel.parts,
            cursorGrapheme: inputPartModel.cursorPartOffset,
            mode: (state.editor.value.trimStart().startsWith('!') ? 'shell' : 'normal') as 'shell' | 'normal',
        },
        sidebar: {
            sessionId: state.activeSessionId ?? '',
            cwd: state.cwd ?? '',
            model: state.model ?? '',
            agent: state.agent ?? '',
            mode: state.interactionMode,
            contextUsed: rendererStatus.contextUsed,
            contextMax: rendererStatus.contextMax,
            costUsdThis: state.costUsdThis ?? 0,
            costUsdToday: state.costUsdToday ?? 0,
            todayMessages: state.todayMessageCount ?? 0,
            lspLines: state.lspStatusLines ?? [],
            dockerLines: state.dockerLines ?? [],
            dockerUrl: state.dockerUrl ?? '',
        },
        status: {
            thinking: rendererStatus.thinking,
            text: rendererStatus.text,
        },
        scroll: {
            // 终端主视图的 scroll 投影始终提交当前 page 的 Rust 投影快照。
            offsetLines: scrollProjection.scrollOffset,
            maxScrollY: 0,
            contentLines: state.page === 'logs' ? state.logLines.length : state.transcriptLines.length,
            stickyBottom: scrollProjection.isFollowingBottom,
            draggingScrollbar: false,
        },
        overlay: overlayState,
        layout: resolvedLayout,
        tick: state.tick ?? 0,
        blink: state.blink ?? false,
    };
}

export function renderTerminalFrame(state: TerminalAppState): void {
    const tuiState = mapAppStateToTUIState(state);
    
    // 全量提交给 Rust
    rustTui.commitState(tuiState);
}
