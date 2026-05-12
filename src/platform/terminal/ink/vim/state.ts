// P23b — Vim state: mode + cursor position.

export type VimMode = 'normal' | 'insert' | 'visual';

export interface VimState {
    mode: VimMode;
    enabled: boolean;
    /** Cursor position in the input string */
    cursor: number;
    /** Visual selection start (inclusive) */
    visualStart?: number;
    /** Pending operator (e.g. 'd', 'y', 'c') */
    pendingOperator?: string;
    /** Register (clipboard) */
    register: string;
}

export function createVimState(enabled = false): VimState {
    return {
        mode: 'insert',
        enabled,
        cursor: 0,
        register: '',
    };
}

export function __resetVimState(state: VimState): VimState {
    return { ...state, mode: 'insert', cursor: 0, visualStart: undefined, pendingOperator: undefined };
}
