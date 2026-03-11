import type { TerminalSize } from './screen-buffer.js';
import { createEditorModel, type EditorModel } from './editor-model.js';
import { createViewportModel, type ViewportModel } from './viewport-model.js';
import type { TranscriptCodeBlock } from './transcript-blocks.js';

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
}

export interface SidebarSection {
    title: string;
    lines: string[];
}

export interface StatusItem {
    text: string;
    tone?: 'normal' | 'muted' | 'accent';
}

export interface TerminalAppState {
    size: TerminalSize;
    transcriptEntries: TerminalTranscriptEntry[];
    transcriptLines: string[];
    transcriptCodeBlocks: TranscriptCodeBlock[];
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
}

export function createInitialTerminalAppState(
    size: TerminalSize,
    options: Partial<Pick<TerminalAppState, 'cwd' | 'model' | 'agent' | 'title'>> = {},
): TerminalAppState {
    return {
        size,
        title: options.title ?? 'XQoder',
        cwd: options.cwd,
        model: options.model,
        agent: options.agent,
        runtimeStatus: 'idle',
        transcriptEntries: [],
        transcriptLines: [],
        transcriptCodeBlocks: [],
        copiedBlockId: null,
        viewport: createViewportModel(),
        editor: createEditorModel(),
        sidebar: [],
        statusItems: [],
    };
}
