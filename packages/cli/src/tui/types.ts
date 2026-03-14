// ============================================================
// 共享类型定义 — TUI 全局类型
// ============================================================

export type PageType = 'chat' | 'logs';

export type OverlayType =
    | 'help'
    | 'quit'
    | 'theme'
    | 'session'
    | 'model'
    | 'permission'
    | 'question'
    | 'commandPalette'
    | 'filePicker'
    | 'init'
    | 'contextCompletion'
    | 'arguments';

export type SidePanelType = 'tool' | 'diff' | 'timeline';

export interface SidePanelState {
    visiblePanels: SidePanelType[];
    focusedPanel: SidePanelType;
}

export interface TuiShellState {
    page: PageType;
    overlay: OverlayType | null;
    sidePanel: SidePanelState;
}

export function createDefaultSidePanelState(): SidePanelState {
    return {
        visiblePanels: [],
        focusedPanel: 'timeline',
    };
}

export function createDefaultTuiShellState(): TuiShellState {
    return {
        page: 'chat',
        overlay: null,
        sidePanel: createDefaultSidePanelState(),
    };
}

export type TuiAction =
    | { type: 'send'; text: string; attachments: string[] }
    | { type: 'session-selected'; sessionId: string }
    | { type: 'model-selected'; model: string }
    | { type: 'theme-selected'; theme: string }
    | { type: 'permission-response'; action: 'allow' | 'allow-session' | 'deny' }
    | { type: 'file-picked'; filePath: string };

export interface PermissionRequest {
    toolName: string;
    params: Record<string, unknown>;
}

export interface Dimensions {
    width: number;
    height: number;
}
