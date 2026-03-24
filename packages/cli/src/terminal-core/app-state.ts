import type { TerminalSize } from './types.js';
import { createEditorModel, type EditorModel } from './editor-model.js';
import { createViewportModel, type ViewportModel } from './viewport-model.js';
import type { TranscriptCodeBlock, EntryLineRange } from './transcript-blocks.js';

export interface TerminalTranscriptEntry {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    timestamp?: number;
    attachments?: string[];
    isStreaming?: boolean;
    success?: boolean;
    rollbackPointId?: string;
}

export interface PendingApprovalState {
    requestId: string;
    kind: string;
    summary: string;
    payload?: string;
}

export interface PendingQuestionState {
    requestId: string;
    header?: string;
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiple?: boolean;
    allowCustom?: boolean;
}

export interface ApprovalInteractionState {
    /** 当前高亮的选项索引：0=Allow once, 1=Always allow (session), 2=Deny */
    selectedIndex: 0 | 1 | 2;
}

export interface QuestionInteractionState {
    selectedIndex: number;
    selected: string[];
    customText: string;
}

export interface SidebarSection {
    title: string;
    lines: string[];
}

export interface StatusItem {
    text: string;
    tone?: 'normal' | 'muted' | 'accent';
}

export interface RendererStatusViewModel {
    thinking: boolean;
    text: string;
    contextUsed: number;
    contextMax: number;
}

/** 浮层 Toast，不占布局，固定位置自动消失 */
export interface Toast {
    id: string;
    text: string;
    kind: 'info' | 'success' | 'error';
    ttl: number;
    createdAt: number;
}

/** Session 列表项（overlay 用） */
export interface OverlaySessionItem {
    id: string;
    title: string;
}

/** Model 列表项（overlay 用） */
export interface OverlayModelItem {
    id: string;
    label: string;
}

/** 命令面板项（overlay 用） */
export interface OverlayCommandItem {
    id: string;
    label: string;
    description?: string;
    pro?: boolean;
}

/** Filepicker 列表项 */
export interface OverlayFilepickerItem {
    path: string;
    label: string;
    isDir: boolean;
}

export interface OverlayFilepickerHistoryEntry {
    dir: string;
    selectedIndex: number;
}

/** Complete 树形项：带深度，用于可展开目录树 */
export interface OverlayCompleteItem extends OverlayFilepickerItem {
    depth: number;
}

/** $ARG 多参数弹窗（自定义命令执行前填变量） */
export interface OverlayArgumentsState {
    type: 'arguments';
    commandName: string;
    variables: string[];
    values: Record<string, string>;
    selectedIndex: number;
    editBuffer: string;
}

/** Theme 列表项（overlay 用） */
export interface OverlayThemeItem {
    id: string;
    label: string;
}

/** Help 列表项（快捷键 + 描述） */
export interface OverlayHelpItem {
    key: string;
    description: string;
    section?: 'Session' | 'Editor' | 'Navigation' | 'Global';
    weight?: number;
}

/** OpenCode 风格 overlay 弹窗：Session / Model / Commands / Filepicker / Complete(@) / Arguments / Theme / Init */
export type OverlayState =
    | { type: 'session'; items: OverlaySessionItem[]; selectedIndex: number }
    | { type: 'model'; providers: string[]; providerIndex: number; items: OverlayModelItem[]; selectedIndex: number }
    | { type: 'commands'; items: OverlayCommandItem[]; allItems: OverlayCommandItem[]; query: string; selectedIndex: number; emptyText?: string }
    | {
        type: 'filepicker';
        currentDir: string;
        items: OverlayFilepickerItem[];
        selectedIndex: number;
        history: OverlayFilepickerHistoryEntry[];
        inputMode: boolean;
        pathBuffer: string;
    }
    | { type: 'complete'; currentDir: string; items: OverlayCompleteItem[]; expandedDirs: string[]; selectedIndex: number; scrollOffset: number }
    | { type: 'theme'; items: OverlayThemeItem[]; selectedIndex: number }
    | { type: 'help'; items: OverlayHelpItem[]; selectedIndex: number }
    | { type: 'init'; items: Array<{ id: string; label: string }>; selectedIndex: number }
    | OverlayArgumentsState;

/** 主区页面：Chat 对话 / Logs 控制台 */
export type MainPage = 'chat' | 'logs';

export interface TerminalAppState {
    size: TerminalSize;
    /** 当前主区页面 */
    page: MainPage;
    transcriptEntries: TerminalTranscriptEntry[];
    transcriptLines: string[];
    transcriptCodeBlocks: TranscriptCodeBlock[];
    /** 每条消息在 transcriptLines 中的行范围，由 withDerivedChrome 填充 */
    transcriptEntryLineRanges: EntryLineRange[];
    transcriptEntryLineStarts: number[];
    transcriptEntryLineEnds: number[];
    transcriptEntryHeights: number[];
    transcriptEntryCumHeights: number[];
    transcriptEntryTotalLines: number;
    copiedBlockId: string | null;
    viewport: ViewportModel;
    editor: EditorModel;
    sidebar: SidebarSection[];
    statusItems: StatusItem[];
    rendererStatus: RendererStatusViewModel;
    title: string;
    cwd?: string;
    activeSessionId?: string;
    model?: string;
    agent?: string;
    runtimeStatus: 'idle' | 'thinking' | 'running-tool' | 'awaiting-approval' | 'done' | 'error';
    runtimeNotice?: string;
    uiNotice?: string;
    notice?: string;
    pendingApproval?: PendingApprovalState;
    approvalInput?: ApprovalInteractionState;
    pendingQuestion?: PendingQuestionState;
    questionInput?: QuestionInteractionState;
    /** 粘贴后短暂显示 [Pasted N lines]，与 OpenCode 一致 */
    pasteHint: { lineCount: number } | null;
    toasts: Toast[];
    /** OpenCode 风格 overlay：Session / Model 选择弹窗 */
    overlay: OverlayState | null;
    /** Overlay 栈：支持多层浮层关闭优先级（Esc 先关顶层） */
    overlayStack: OverlayState[];
    /** Logs 页：控制台输出行 */
    logLines: string[];
    /** Logs 页的 viewport（与 transcript 分开） */
    logViewport: ViewportModel;
    /** 本 session 内工具修改过的文件路径（Sidebar Modified files） */
    modifiedFiles: string[];
    /** 终端主题 id（Theme 对话框选中），用于 renderTerminalFrame */
    themeId: string;
    /** 展开的 diff block id 列表（其余保持 folded） */
    diffExpandedBlockIds: string[];
    /** 展开的 context group id 列表（其余保持 collapsed） */
    expandedContextGroupIds: string[];
    /** 交互模式：build 直接执行，plan 先给方案 */
    interactionMode: 'build' | 'plan';
    /** 运行中呼吸灯帧 */
    runtimePulseFrame: number;
    /** footer/sidebar 本次成本（USD） */
    costUsdThis: number;
    /** footer/sidebar 今日累计成本（USD，来自 SQLite 汇总） */
    costUsdToday: number;
    /** 今日累计对话消息数（来自 SQLite 汇总） */
    todayMessageCount: number;
    /** LSP 状态行（侧边栏展示） */
    lspStatusLines: string[];

    /** Docker 沙盒状态（来自 transcript 中的 Docker Sandbox 输出解析） */
    dockerLines: string[];
    /** Docker 沙盒对外访问 URL（来自 Port 行解析），用于“在浏览器打开”（可选） */
    dockerUrl: string;
}

export function createInitialTerminalAppState(
    size: TerminalSize,
    options: Partial<Pick<TerminalAppState, 'cwd' | 'model' | 'agent' | 'title' | 'themeId'>> = {},
): TerminalAppState {
    return {
        size,
        page: 'chat',
        title: options.title ?? 'XQoder',
        cwd: options.cwd,
        model: options.model,
        agent: options.agent,
        runtimeStatus: 'idle',
        runtimeNotice: undefined,
        uiNotice: undefined,
        transcriptEntries: [],
        transcriptLines: [],
        transcriptCodeBlocks: [],
        transcriptEntryLineRanges: [],
        transcriptEntryLineStarts: [],
        transcriptEntryLineEnds: [],
        transcriptEntryHeights: [],
        transcriptEntryCumHeights: [],
        transcriptEntryTotalLines: 0,
        copiedBlockId: null,
        viewport: createViewportModel(),
        editor: { ...createEditorModel(), contentWidth: Math.max(10, size.width - 6) },
        sidebar: [],
        statusItems: [],
        rendererStatus: {
            thinking: false,
            text: 'Ready',
            contextUsed: 0,
            contextMax: 200000,
        },
        pasteHint: null,
        toasts: [],
        overlay: null,
        overlayStack: [],
        logLines: [],
        logViewport: createViewportModel(),
        modifiedFiles: [],
        themeId: options.themeId ?? 'default',
        diffExpandedBlockIds: [],
        expandedContextGroupIds: [],
        interactionMode: 'build',
        runtimePulseFrame: 0,
        costUsdThis: 0,
        costUsdToday: 0,
        todayMessageCount: 0,
        lspStatusLines: [],
        dockerLines: [],
        dockerUrl: '',
    };
}
