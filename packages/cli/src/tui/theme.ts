// ============================================================
// 主题引擎 — 语义化颜色 Token 系统
// 参考 OpenCode: internal/tui/theme/theme.go
// ============================================================

import chalk, { type ChalkInstance } from 'chalk';

/**
 * Theme 接口
 * 所有主题必须实现此接口，提供语义化的颜色 Token
 */
export interface Theme {
    readonly name: string;

    // 基础色
    primary: string;
    secondary: string;
    accent: string;

    // 状态色
    error: string;
    warning: string;
    success: string;
    info: string;

    // 文本色
    text: string;
    textMuted: string;
    textEmphasized: string;

    // 背景色
    background: string;
    backgroundSecondary: string;
    backgroundDarker: string;

    // 边框色
    borderNormal: string;
    borderFocused: string;
    borderDim: string;

    // Markdown 色
    markdownHeading: string;
    markdownCode: string;
    markdownLink: string;
    markdownBlockQuote: string;

    // 语法高亮色
    syntaxComment: string;
    syntaxKeyword: string;
    syntaxFunction: string;
    syntaxString: string;
    syntaxNumber: string;
    syntaxType: string;
    syntaxOperator: string;

    // Diff 色
    diffAdded: string;
    diffRemoved: string;
    diffContext: string;
}

/**
 * 主题化的 chalk 工具
 */
export interface ThemedStyles {
    primary: ChalkInstance;
    secondary: ChalkInstance;
    accent: ChalkInstance;
    error: ChalkInstance;
    warning: ChalkInstance;
    success: ChalkInstance;
    info: ChalkInstance;
    text: ChalkInstance;
    muted: ChalkInstance;
    emphasized: ChalkInstance;
    heading: ChalkInstance;
    code: ChalkInstance;
    link: ChalkInstance;
    diffAdded: ChalkInstance;
    diffRemoved: ChalkInstance;
    border: (focused?: boolean) => string;
}

export function createThemedStyles(theme: Theme): ThemedStyles {
    return {
        primary: chalk.hex(theme.primary),
        secondary: chalk.hex(theme.secondary),
        accent: chalk.hex(theme.accent),
        error: chalk.hex(theme.error),
        warning: chalk.hex(theme.warning),
        success: chalk.hex(theme.success),
        info: chalk.hex(theme.info),
        text: chalk.hex(theme.text),
        muted: chalk.hex(theme.textMuted),
        emphasized: chalk.hex(theme.textEmphasized).bold,
        heading: chalk.hex(theme.markdownHeading).bold,
        code: chalk.hex(theme.markdownCode),
        link: chalk.hex(theme.markdownLink).underline,
        diffAdded: chalk.hex(theme.diffAdded),
        diffRemoved: chalk.hex(theme.diffRemoved),
        border: (focused = false) => focused ? theme.borderFocused : theme.borderNormal,
    };
}

// ---- 预设主题 ----

/** Catppuccin Mocha — 柔和暗色主题 */
export const catppuccinMocha: Theme = {
    name: 'Catppuccin Mocha',
    primary: '#89b4fa',       // Blue
    secondary: '#cba6f7',     // Mauve
    accent: '#f5c2e7',        // Pink
    error: '#f38ba8',         // Red
    warning: '#fab387',       // Peach
    success: '#a6e3a1',       // Green
    info: '#89dceb',          // Sky
    text: '#cdd6f4',          // Text
    textMuted: '#6c7086',     // Overlay0
    textEmphasized: '#f5e0dc', // Rosewater
    background: '#1e1e2e',    // Base
    backgroundSecondary: '#313244', // Surface0
    backgroundDarker: '#181825',    // Mantle
    borderNormal: '#45475a',  // Surface1
    borderFocused: '#89b4fa', // Blue
    borderDim: '#313244',     // Surface0
    markdownHeading: '#89b4fa',
    markdownCode: '#a6e3a1',
    markdownLink: '#89dceb',
    markdownBlockQuote: '#6c7086',
    syntaxComment: '#6c7086',
    syntaxKeyword: '#cba6f7',
    syntaxFunction: '#89b4fa',
    syntaxString: '#a6e3a1',
    syntaxNumber: '#fab387',
    syntaxType: '#f9e2af',
    syntaxOperator: '#89dceb',
    diffAdded: '#a6e3a1',
    diffRemoved: '#f38ba8',
    diffContext: '#6c7086',
};

/** Dracula — 经典暗色主题 */
export const dracula: Theme = {
    name: 'Dracula',
    primary: '#bd93f9',
    secondary: '#ff79c6',
    accent: '#8be9fd',
    error: '#ff5555',
    warning: '#ffb86c',
    success: '#50fa7b',
    info: '#8be9fd',
    text: '#f8f8f2',
    textMuted: '#6272a4',
    textEmphasized: '#f1fa8c',
    background: '#282a36',
    backgroundSecondary: '#44475a',
    backgroundDarker: '#21222c',
    borderNormal: '#44475a',
    borderFocused: '#bd93f9',
    borderDim: '#383a59',
    markdownHeading: '#bd93f9',
    markdownCode: '#50fa7b',
    markdownLink: '#8be9fd',
    markdownBlockQuote: '#6272a4',
    syntaxComment: '#6272a4',
    syntaxKeyword: '#ff79c6',
    syntaxFunction: '#50fa7b',
    syntaxString: '#f1fa8c',
    syntaxNumber: '#bd93f9',
    syntaxType: '#8be9fd',
    syntaxOperator: '#ff79c6',
    diffAdded: '#50fa7b',
    diffRemoved: '#ff5555',
    diffContext: '#6272a4',
};

/** Tokyo Night — 东京之夜 */
export const tokyoNight: Theme = {
    name: 'Tokyo Night',
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    accent: '#7dcfff',
    error: '#f7768e',
    warning: '#e0af68',
    success: '#9ece6a',
    info: '#7dcfff',
    text: '#c0caf5',
    textMuted: '#565f89',
    textEmphasized: '#e0af68',
    background: '#1a1b26',
    backgroundSecondary: '#24283b',
    backgroundDarker: '#16161e',
    borderNormal: '#3b4261',
    borderFocused: '#7aa2f7',
    borderDim: '#292e42',
    markdownHeading: '#7aa2f7',
    markdownCode: '#9ece6a',
    markdownLink: '#7dcfff',
    markdownBlockQuote: '#565f89',
    syntaxComment: '#565f89',
    syntaxKeyword: '#bb9af7',
    syntaxFunction: '#7aa2f7',
    syntaxString: '#9ece6a',
    syntaxNumber: '#ff9e64',
    syntaxType: '#2ac3de',
    syntaxOperator: '#89ddff',
    diffAdded: '#9ece6a',
    diffRemoved: '#f7768e',
    diffContext: '#565f89',
};

/** Gruvbox Dark — 暖色暗主题 */
export const gruvbox: Theme = {
    name: 'Gruvbox Dark',
    primary: '#83a598',
    secondary: '#d3869b',
    accent: '#8ec07c',
    error: '#fb4934',
    warning: '#fe8019',
    success: '#b8bb26',
    info: '#83a598',
    text: '#ebdbb2',
    textMuted: '#928374',
    textEmphasized: '#fabd2f',
    background: '#282828',
    backgroundSecondary: '#3c3836',
    backgroundDarker: '#1d2021',
    borderNormal: '#504945',
    borderFocused: '#83a598',
    borderDim: '#3c3836',
    markdownHeading: '#83a598',
    markdownCode: '#b8bb26',
    markdownLink: '#8ec07c',
    markdownBlockQuote: '#928374',
    syntaxComment: '#928374',
    syntaxKeyword: '#fb4934',
    syntaxFunction: '#b8bb26',
    syntaxString: '#b8bb26',
    syntaxNumber: '#d3869b',
    syntaxType: '#fabd2f',
    syntaxOperator: '#8ec07c',
    diffAdded: '#b8bb26',
    diffRemoved: '#fb4934',
    diffContext: '#928374',
};

/** XQoder Default — Xqoder 品牌主题 */
export const xqoderDefault: Theme = {
    name: 'Xqoder Default',
    primary: '#6EC1E4',       // 品牌蓝
    secondary: '#A78BFA',     // 柔紫
    accent: '#34D399',        // 翡翠绿
    error: '#EF4444',
    warning: '#F59E0B',
    success: '#10B981',
    info: '#3B82F6',
    text: '#E5E7EB',
    textMuted: '#6B7280',
    textEmphasized: '#F9FAFB',
    background: '#111827',
    backgroundSecondary: '#1F2937',
    backgroundDarker: '#0B0F19',
    borderNormal: '#374151',
    borderFocused: '#6EC1E4',
    borderDim: '#1F2937',
    markdownHeading: '#6EC1E4',
    markdownCode: '#34D399',
    markdownLink: '#3B82F6',
    markdownBlockQuote: '#6B7280',
    syntaxComment: '#6B7280',
    syntaxKeyword: '#A78BFA',
    syntaxFunction: '#6EC1E4',
    syntaxString: '#34D399',
    syntaxNumber: '#F59E0B',
    syntaxType: '#F472B6',
    syntaxOperator: '#3B82F6',
    diffAdded: '#10B981',
    diffRemoved: '#EF4444',
    diffContext: '#6B7280',
};

/** Flexoki — 现代暖色墨水风 */
export const flexoki: Theme = {
    name: 'Flexoki',
    primary: '#d0a215',       // 黄
    secondary: '#879a39',     // 绿
    accent: '#4385be',        // 蓝
    error: '#d14d41',
    warning: '#da702c',
    success: '#879a39',
    info: '#4385be',
    text: '#cecdc3',
    textMuted: '#6f6e69',
    textEmphasized: '#fffcf0',
    background: '#100f0f',
    backgroundSecondary: '#1c1b1a',
    backgroundDarker: '#0d0c0c',
    borderNormal: '#282726',
    borderFocused: '#d0a215',
    borderDim: '#1c1b1a',
    markdownHeading: '#d0a215',
    markdownCode: '#879a39',
    markdownLink: '#4385be',
    markdownBlockQuote: '#6f6e69',
    syntaxComment: '#6f6e69',
    syntaxKeyword: '#d0a215',
    syntaxFunction: '#4385be',
    syntaxString: '#879a39',
    syntaxNumber: '#da702c',
    syntaxType: '#ce5d97',
    syntaxOperator: '#3aa99f',
    diffAdded: '#879a39',
    diffRemoved: '#d14d41',
    diffContext: '#6f6e69',
};

/** Monokai — 经典代码高亮 */
export const monokai: Theme = {
    name: 'Monokai',
    primary: '#f92672',       // 粉红
    secondary: '#66d9e8',     // 青
    accent: '#a6e22e',        // 绿
    error: '#f92672',
    warning: '#fd971f',
    success: '#a6e22e',
    info: '#66d9e8',
    text: '#f8f8f2',
    textMuted: '#75715e',
    textEmphasized: '#ffffff',
    background: '#272822',
    backgroundSecondary: '#3e3d32',
    backgroundDarker: '#1e1f1c',
    borderNormal: '#49483e',
    borderFocused: '#f92672',
    borderDim: '#3e3d32',
    markdownHeading: '#f92672',
    markdownCode: '#a6e22e',
    markdownLink: '#66d9e8',
    markdownBlockQuote: '#75715e',
    syntaxComment: '#75715e',
    syntaxKeyword: '#f92672',
    syntaxFunction: '#a6e22e',
    syntaxString: '#e6db74',
    syntaxNumber: '#ae81ff',
    syntaxType: '#66d9e8',
    syntaxOperator: '#f92672',
    diffAdded: '#a6e22e',
    diffRemoved: '#f92672',
    diffContext: '#75715e',
};

/** One Dark — Atom 编辑器经典 */
export const oneDark: Theme = {
    name: 'One Dark',
    primary: '#61afef',       // 蓝
    secondary: '#c678dd',     // 紫
    accent: '#98c379',        // 绿
    error: '#e06c75',
    warning: '#e5c07b',
    success: '#98c379',
    info: '#56b6c2',
    text: '#abb2bf',
    textMuted: '#5c6370',
    textEmphasized: '#ffffff',
    background: '#282c34',
    backgroundSecondary: '#31353f',
    backgroundDarker: '#21252b',
    borderNormal: '#3e4451',
    borderFocused: '#61afef',
    borderDim: '#31353f',
    markdownHeading: '#61afef',
    markdownCode: '#98c379',
    markdownLink: '#56b6c2',
    markdownBlockQuote: '#5c6370',
    syntaxComment: '#5c6370',
    syntaxKeyword: '#c678dd',
    syntaxFunction: '#61afef',
    syntaxString: '#98c379',
    syntaxNumber: '#d19a66',
    syntaxType: '#e5c07b',
    syntaxOperator: '#56b6c2',
    diffAdded: '#98c379',
    diffRemoved: '#e06c75',
    diffContext: '#5c6370',
};

/** Tron — 霓虹赛博朋克 */
export const tron: Theme = {
    name: 'Tron',
    primary: '#28c7cb',       // 青蓝
    secondary: '#0984e3',     // 深蓝
    accent: '#00cec9',        // 青
    error: '#ff4757',
    warning: '#ffa502',
    success: '#2ed573',
    info: '#28c7cb',
    text: '#b2d8d8',
    textMuted: '#4d7f7f',
    textEmphasized: '#e0ffff',
    background: '#000000',
    backgroundSecondary: '#0a0a0a',
    backgroundDarker: '#000000',
    borderNormal: '#0d3333',
    borderFocused: '#28c7cb',
    borderDim: '#0a1a1a',
    markdownHeading: '#28c7cb',
    markdownCode: '#00cec9',
    markdownLink: '#0984e3',
    markdownBlockQuote: '#4d7f7f',
    syntaxComment: '#4d7f7f',
    syntaxKeyword: '#28c7cb',
    syntaxFunction: '#00cec9',
    syntaxString: '#2ed573',
    syntaxNumber: '#ffa502',
    syntaxType: '#0984e3',
    syntaxOperator: '#28c7cb',
    diffAdded: '#2ed573',
    diffRemoved: '#ff4757',
    diffContext: '#4d7f7f',
};

/** High Contrast — 高对比度无障碍主题 */
export const highContrast: Theme = {
    name: 'High Contrast',
    primary: '#00BFFF',
    secondary: '#FFD700',
    accent: '#00FF7F',
    error: '#FF0000',
    warning: '#FFA500',
    success: '#00FF00',
    info: '#00BFFF',
    text: '#FFFFFF',
    textMuted: '#AAAAAA',
    textEmphasized: '#FFFFFF',
    background: '#000000',
    backgroundSecondary: '#1A1A1A',
    backgroundDarker: '#000000',
    borderNormal: '#FFFFFF',
    borderFocused: '#00BFFF',
    borderDim: '#666666',
    markdownHeading: '#00BFFF',
    markdownCode: '#00FF00',
    markdownLink: '#FFD700',
    markdownBlockQuote: '#AAAAAA',
    syntaxComment: '#AAAAAA',
    syntaxKeyword: '#FFD700',
    syntaxFunction: '#00BFFF',
    syntaxString: '#00FF00',
    syntaxNumber: '#FFA500',
    syntaxType: '#FF69B4',
    syntaxOperator: '#FFFFFF',
    diffAdded: '#00FF00',
    diffRemoved: '#FF0000',
    diffContext: '#AAAAAA',
};

// ---- 主题管理器 ----

/** 所有可用主题 */
export const themes: Record<string, Theme> = {
    'xqoder': xqoderDefault,
    'catppuccin': catppuccinMocha,
    'dracula': dracula,
    'tokyo-night': tokyoNight,
    'gruvbox': gruvbox,
    'flexoki': flexoki,
    'monokai': monokai,
    'one-dark': oneDark,
    'tron': tron,
    'high-contrast': highContrast,
};

let currentThemeName = 'xqoder';

function prefersLightTerminalBackground(): boolean {
    const colorfgbg = process.env['COLORFGBG'];
    if (!colorfgbg) return false;
    const parts = colorfgbg.split(';').map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
    if (parts.length === 0) return false;
    const bg = parts[parts.length - 1] ?? 0;
    // Common terminal convention:
    // 0-6 are darker palette slots, 7-15 are lighter slots.
    return bg >= 7;
}

function withReadableContrast(theme: Theme): Theme {
    if (!prefersLightTerminalBackground()) {
        return theme;
    }

    return {
        ...theme,
        // Keep brand/accent colors, but force readable foregrounds on light terminals.
        text: '#111827',
        textMuted: '#4b5563',
        textEmphasized: '#0f172a',
        borderNormal: '#9ca3af',
        borderDim: '#d1d5db',
        markdownBlockQuote: '#6b7280',
        diffContext: '#6b7280',
        syntaxComment: '#6b7280',
    };
}

export function setTheme(name: string): void {
    if (themes[name]) {
        currentThemeName = name;
    }
}

export function getTheme(): Theme {
    return withReadableContrast(themes[currentThemeName] ?? xqoderDefault);
}

export function getThemeName(): string {
    return currentThemeName;
}

export function getThemeNames(): string[] {
    return Object.keys(themes);
}
