import type { TerminalSize } from './screen-buffer.js';
import { createEditorModel, type EditorModel } from './editor-model.js';
import { createViewportModel, type ViewportModel } from './viewport-model.js';
import type { TranscriptCodeBlock, EntryLineRange } from './transcript-blocks.js';

export interface TerminalTranscriptEntry {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    attachments?: string[];
    isStreaming?: boolean;
    success?: boolean;
}

export interface PendingApprovalState {
    requestId: string;
    kind: string;
    summary: string;
    payload?: string;
    /** 当前高亮的选项索引：0=Allow once, 1=Always allow (session), 2=Deny */
    selectedIndex?: number;
}

export interface PendingQuestionState {
    requestId: string;
    header?: string;
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiple?: boolean;
    allowCustom?: boolean;
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
}

/** Filepicker 列表项 */
export interface OverlayFilepickerItem {
    path: string;
    label: string;
    isDir: boolean;
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

/** OpenCode 风格 overlay 弹窗：Session / Model / Commands / Filepicker / Complete(@) / Arguments / Theme / Init */
export type OverlayState =
    | { type: 'session'; items: OverlaySessionItem[]; selectedIndex: number }
    | { type: 'model'; providers: string[]; providerIndex: number; items: OverlayModelItem[]; selectedIndex: number }
    | { type: 'commands'; items: OverlayCommandItem[]; selectedIndex: number }
    | { type: 'filepicker'; currentDir: string; items: OverlayFilepickerItem[]; selectedIndex: number }
    | { type: 'complete'; currentDir: string; items: OverlayCompleteItem[]; expandedDirs: string[]; selectedIndex: number }
    | { type: 'theme'; items: OverlayThemeItem[]; selectedIndex: number }
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
    copiedBlockId: string | null;
    viewport: ViewportModel;
    editor: EditorModel;
    sidebar: SidebarSection[];
    statusItems: StatusItem[];
    title: string;
    cwd?: string;
    activeSessionId?: string;
    model?: string;
    agent?: string;
    runtimeStatus: 'idle' | 'thinking' | 'running-tool' | 'awaiting-approval' | 'done' | 'error';
    notice?: string;
    pendingApproval?: PendingApprovalState;
    pendingQuestion?: PendingQuestionState;
    /** 粘贴后短暂显示 [Pasted N lines]，与 OpenCode 一致 */
    pasteHint: { lineCount: number } | null;
    toasts: Toast[];
    /** OpenCode 风格 overlay：Session / Model 选择弹窗 */
    overlay: OverlayState | null;
    /** Logs 页：控制台输出行 */
    logLines: string[];
    /** Logs 页的 viewport（与 transcript 分开） */
    logViewport: ViewportModel;
    /** 本 session 内工具修改过的文件路径（Sidebar Modified files） */
    modifiedFiles: string[];
    /** 终端主题 id（Theme 对话框选中），用于 renderTerminalFrame */
    themeId: string;
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
        transcriptEntries: [],
        transcriptLines: [],
        transcriptCodeBlocks: [],
        transcriptEntryLineRanges: [],
        copiedBlockId: null,
        viewport: createViewportModel(),
        editor: { ...createEditorModel(), contentWidth: Math.max(10, size.width - 6) },
        sidebar: [],
        statusItems: [],
        pasteHint: null,
        toasts: [],
        overlay: null,
        logLines: [],
        logViewport: createViewportModel(),
        modifiedFiles: [],
        themeId: options.themeId ?? 'default',
    };
}
