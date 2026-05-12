// P23a — Default keybindings: 20+ bindings aligned with OpenClaude defaults.

export interface Keybinding {
    id: string;
    /** Key combos, e.g. 'ctrl+c', 'shift+tab', 'escape' */
    keys: string[];
    /** Command identifier */
    command: string;
    /** Optional context expression (e.g. 'vim.mode == normal') */
    when?: string;
    description?: string;
}

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
    // Session control
    { id: 'cancel', keys: ['ctrl+c'], command: 'cancel', description: 'Cancel current turn' },
    { id: 'exit', keys: ['ctrl+d'], command: 'exit', description: 'Exit XQoder' },
    { id: 'new-session', keys: ['ctrl+n'], command: 'new-session', description: 'Start a new session' },

    // Scrollback
    { id: 'clear', keys: ['ctrl+l'], command: 'clear', description: 'Clear scrollback' },
    { id: 'scroll-up', keys: ['pageup'], command: 'scroll-up', description: 'Scroll up' },
    { id: 'scroll-down', keys: ['pagedown'], command: 'scroll-down', description: 'Scroll down' },

    // History
    { id: 'history-search', keys: ['ctrl+r'], command: 'history-search', description: 'Open history search' },
    { id: 'history-prev', keys: ['up'], command: 'history-prev', description: 'Previous history entry' },
    { id: 'history-next', keys: ['down'], command: 'history-next', description: 'Next history entry' },

    // Editing
    { id: 'copy-last-response', keys: ['ctrl+shift+c'], command: 'copy-last-response', description: 'Copy last response' },
    { id: 'command-palette', keys: ['ctrl+k'], command: 'command-palette', description: 'Open command palette' },
    { id: 'autocomplete', keys: ['tab'], command: 'autocomplete', when: 'vim.mode != normal', description: 'Autocomplete / expand thinking' },

    // Permission mode
    { id: 'cycle-permission-mode', keys: ['shift+tab'], command: 'cycle-permission-mode', description: 'Cycle permission mode' },

    // Vim
    { id: 'vim-toggle', keys: ['escape'], command: 'vim-toggle', when: 'vim.enabled', description: 'Toggle vim normal/insert mode' },

    // Compact / memory
    { id: 'compact', keys: ['ctrl+shift+k'], command: 'compact', description: 'Compact session' },

    // Submit
    { id: 'submit', keys: ['return'], command: 'submit', description: 'Submit prompt' },
    { id: 'newline', keys: ['shift+return'], command: 'newline', description: 'Insert newline' },

    // Line editing
    { id: 'line-start', keys: ['ctrl+a'], command: 'line-start', description: 'Move to line start' },
    { id: 'line-end', keys: ['ctrl+e'], command: 'line-end', description: 'Move to line end' },
    { id: 'kill-line', keys: ['ctrl+k'], command: 'kill-line', when: 'input.focused', description: 'Delete to end of line' },
    { id: 'kill-line-back', keys: ['ctrl+u'], command: 'kill-line-back', description: 'Delete to start of line' },
    { id: 'word-back', keys: ['ctrl+w'], command: 'word-back', description: 'Delete previous word' },
];
