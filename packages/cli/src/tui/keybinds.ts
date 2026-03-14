// ============================================================
// TUI Keybind Configuration
// Maps keybind names to key combinations, with user overrides.
// ============================================================

import type { TuiKeybindsConfig } from '@xqoder/shared';

export interface KeyCombo {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
}

export type KeybindAction =
    | 'copy'
    | 'quit'
    | 'help'
    | 'theme'
    | 'session'
    | 'newSession'
    | 'model'
    | 'commandPalette'
    | 'filePicker'
    | 'contextCompletion'
    | 'logs'
    | 'mouseToggle'
    | 'agentCycle'
    | 'timelineNext'
    | 'timelinePrev'
    | 'timelineToggle'
    | 'panelNext'
    | 'panelPrev';

const DEFAULT_KEYBINDS: Record<KeybindAction, string> = {
    copy: 'ctrl+y',
    quit: 'ctrl+c',
    help: 'ctrl+?',
    theme: 'ctrl+t',
    session: 'ctrl+s',
    newSession: 'ctrl+n',
    model: 'ctrl+o',
    commandPalette: 'ctrl+k',
    filePicker: 'ctrl+f',
    contextCompletion: 'ctrl+p',
    logs: 'ctrl+l',
    mouseToggle: 'ctrl+g',
    agentCycle: 'ctrl+a',
    timelineNext: 'ctrl+j',
    timelinePrev: 'ctrl+shift+k',
    timelineToggle: 'ctrl+u',
    panelNext: 'ctrl+]',
    panelPrev: 'ctrl+[',
};

function parseKeyCombo(spec: string): KeyCombo {
    const parts = spec.toLowerCase().split('+');
    const combo: KeyCombo = { key: '' };

    for (const part of parts) {
        switch (part) {
            case 'ctrl':
                combo.ctrl = true;
                break;
            case 'meta':
            case 'cmd':
            case 'alt':
                combo.meta = true;
                break;
            case 'shift':
                combo.shift = true;
                break;
            default:
                combo.key = part;
                break;
        }
    }

    return combo;
}

export interface ResolvedKeybinds {
    binds: Map<KeybindAction, KeyCombo>;
    matchAction(input: string, key: { ctrl: boolean; meta: boolean; shift: boolean; tab: boolean }): KeybindAction | null;
}

export function resolveKeybinds(userConfig?: TuiKeybindsConfig): ResolvedKeybinds {
    const binds = new Map<KeybindAction, KeyCombo>();

    for (const [action, defaultSpec] of Object.entries(DEFAULT_KEYBINDS)) {
        const userSpec = userConfig?.[action];
        const spec = typeof userSpec === 'string' ? userSpec : defaultSpec;
        binds.set(action as KeybindAction, parseKeyCombo(spec));
    }

    function matchAction(
        input: string,
        key: { ctrl: boolean; meta: boolean; shift: boolean; tab: boolean },
    ): KeybindAction | null {
        for (const [action, combo] of binds.entries()) {
            const ctrlMatch = (combo.ctrl ?? false) === key.ctrl;
            const metaMatch = (combo.meta ?? false) === key.meta;
            const shiftMatch = (combo.shift ?? false) === key.shift;
            const keyMatch = input.toLowerCase() === combo.key;

            if (ctrlMatch && metaMatch && shiftMatch && keyMatch) {
                return action;
            }
        }
        return null;
    }

    return { binds, matchAction };
}
