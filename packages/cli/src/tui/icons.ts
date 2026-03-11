// ============================================================
// TUI Icons — 统一图标集合
// 参考 OpenCode: internal/tui/styles/icons.go
// ============================================================

export const ICONS = {
    check: '✓',
    cross: '✗',
    warning: '⚠',
    info: 'ℹ',
    spinner: '◐',
    arrow: '→',
    arrowLeft: '←',
    arrowUp: '↑',
    arrowDown: '↓',
    bullet: '•',
    ellipsis: '…',
    thinking: '🧠',
    tool: '🔧',
    file: '📄',
    folder: '📁',
    search: '🔍',
    edit: '✏️',
    trash: '🗑',
    lock: '🔒',
    unlock: '🔓',
    star: '★',
    clock: '⏱',
    dollar: '💰',
    token: '🪙',
    agent: '🤖',
    user: '👤',
    system: '⚙',
    git: '⎇',
    terminal: '❯',
    success: '✅',
    error: '❌',
    pending: '⏳',
    running: '⏳',
    copied: '📋',
    link: '🔗',
    pin: '📌',
    tag: '🏷',
    expand: '▸',
    collapse: '▾',
    separator: '│',
    horizontalLine: '─',
    corner: '╰',
    tee: '├',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
    return ICONS[name];
}
