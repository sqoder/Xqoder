// ============================================================
// Markdown 渲染器 — 终端 Markdown 渲染
// 参考 OpenCode: components/chat/message.go toMarkdown()
// ============================================================

import chalk from 'chalk';
import { getTheme, type Theme } from './theme.js';

/**
 * 将 Markdown 文本渲染为带 ANSI 样式的终端文本
 */
export function renderMarkdown(source: string, width: number = 80): string {
    const theme = getTheme();
    const lines = source.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 代码块开始/结束
        if (line.trimStart().startsWith('```')) {
            if (inCodeBlock) {
                // 结束代码块
                result.push(renderCodeBlock(codeLines.join('\n'), codeBlockLang, width, theme));
                inCodeBlock = false;
                codeLines = [];
                codeBlockLang = '';
            } else {
                // 开始代码块
                inCodeBlock = true;
                codeBlockLang = line.trimStart().slice(3).trim();
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        // 标题
        const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            result.push(renderHeading(text, level, width, theme));
            continue;
        }

        // 水平线
        if (/^[-*_]{3,}\s*$/.test(line.trim())) {
            result.push(chalk.hex(theme.borderNormal)('─'.repeat(Math.min(width - 4, 60))));
            continue;
        }

        // 引用块
        if (line.trimStart().startsWith('>')) {
            const quote = line.replace(/^\s*>\s?/, '');
            result.push(
                chalk.hex(theme.borderDim)('│ ') +
                chalk.hex(theme.markdownBlockQuote).italic(renderInline(quote, theme)),
            );
            continue;
        }

        // Task list (- [x] or - [ ])
        const taskMatch = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)/);
        if (taskMatch) {
            const indent = taskMatch[1];
            const checked = taskMatch[3] !== ' ';
            const text = taskMatch[4];
            const box = checked ? '[x]' : '[ ]';
            const styledText = checked
                ? chalk.hex(theme.textMuted).strikethrough(renderInline(text, theme))
                : renderInline(text, theme);
            result.push(`${indent}${box} ${styledText}`);
            continue;
        }

        // 无序列表
        const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
        if (ulMatch) {
            const indent = ulMatch[1];
            const bullet = chalk.hex(theme.accent)('-');
            result.push(`${indent}${bullet} ${renderInline(ulMatch[3], theme)}`);
            continue;
        }

        // 有序列表
        const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (olMatch) {
            const indent = olMatch[1];
            const num = olMatch[2];
            const text = olMatch[3];
            result.push(
                `${indent}${chalk.hex(theme.accent)(num + '.')} ${renderInline(text, theme)}`,
            );
            continue;
        }

        // Table row (| col1 | col2 | col3 |)
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            const isSeparator = /^\|[\s:]*[-]+/.test(line.trim());
            if (isSeparator) {
                result.push(chalk.hex(theme.borderDim)(line.replace(/-/g, '─').replace(/\|/g, '┼')));
            } else {
                const cells = line.split('|').slice(1, -1);
                const styled = cells.map(c =>
                    chalk.hex(theme.borderDim)('│') + ' ' + renderInline(c.trim(), theme) + ' ',
                ).join('') + chalk.hex(theme.borderDim)('│');
                result.push(styled);
            }
            continue;
        }

        // Image reference (![alt](url))
        const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (imgMatch) {
            const alt = imgMatch[1] || 'image';
            const url = imgMatch[2];
            result.push(
                chalk.hex(theme.text).bold(alt) +
                chalk.hex(theme.textMuted)(` (${url})`),
            );
            continue;
        }

        // 空行
        if (line.trim() === '') {
            result.push('');
            continue;
        }

        // 普通文本（word wrap）
        result.push(wordWrap(renderInline(line, theme), width));
    }

    // 如果代码块未关闭
    if (inCodeBlock) {
        result.push(renderCodeBlock(codeLines.join('\n'), codeBlockLang, width, theme));
    }

    return result.join('\n');
}

/**
 * 渲染行内 Markdown 元素
 */
function renderInline(text: string, theme: Theme): string {
    let result = text;

    // 行内代码
    result = result.replace(/`([^`]+)`/g, (_m, code) =>
        chalk.hex(theme.markdownCode)(` ${code} `),
    );

    // 加粗
    result = result.replace(/\*\*([^*]+)\*\*/g, (_m, bold) =>
        chalk.hex(theme.textEmphasized).bold(bold),
    );

    // 斜体
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, italic) =>
        chalk.hex(theme.text).italic(italic),
    );

    // 链接
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) =>
        chalk.hex(theme.markdownLink).underline(linkText) +
        chalk.hex(theme.textMuted)(` (${url})`),
    );

    // 删除线
    result = result.replace(/~~([^~]+)~~/g, (_m, del) =>
        chalk.hex(theme.textMuted).strikethrough(del),
    );

    return result;
}

/**
 * 渲染标题
 */
function renderHeading(text: string, level: number, width: number, theme: Theme): string {
    const prefix = chalk.hex(theme.markdownHeading)('#'.repeat(level));
    const content = chalk.hex(theme.markdownHeading).bold(text);

    if (level <= 2) {
        const lineLen = Math.min(width - 4, 60);
        const line = chalk.hex(theme.borderDim)('─'.repeat(lineLen));
        return `\n${prefix} ${content}\n${line}`;
    }

    return `${prefix} ${content}`;
}

/**
 * 渲染代码块
 */
function renderCodeBlock(code: string, lang: string, width: number, theme: Theme): string {
    const maxWidth = Math.min(width - 6, 80);
    const lines = code.split('\n');

    // 语言标签
    const langLabel = lang
        ? chalk.hex(theme.textMuted).italic(` ${lang} `)
        : '';

    // 上边框
    const topBorder = chalk.hex(theme.borderNormal)(
        '┌' + '─'.repeat(maxWidth - 2) + '┐',
    );

    // 代码行
    const codeRendered = lines.map((line, idx) => {
        const lineNum = chalk.hex(theme.textMuted)(
            String(idx + 1).padStart(3) + ' ',
        );
        const codeLine = renderSyntax(line, lang, theme);
        const paddedLine = codeLine.length <= maxWidth - 7
            ? codeLine
            : codeLine.slice(0, maxWidth - 10) + chalk.hex(theme.textMuted)('...');
        return chalk.hex(theme.borderNormal)('│') + lineNum + paddedLine;
    });

    // 下边框
    const bottomBorder = chalk.hex(theme.borderNormal)(
        '└' + '─'.repeat(maxWidth - 2) + '┘',
    );

    return [
        langLabel ? `${langLabel}` : '',
        topBorder,
        ...codeRendered,
        bottomBorder,
    ].filter(Boolean).join('\n');
}

/**
 * 语言关键字映射（参考 OpenCode: Chroma 语法高亮）
 */
const LANG_KEYWORDS: Record<string, string[]> = {
    _common: [
        'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class',
        'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break',
        'continue', 'new', 'this', 'super', 'extends', 'implements',
        'async', 'await', 'try', 'catch', 'throw', 'finally',
        'interface', 'type', 'enum', 'abstract', 'readonly',
        'public', 'private', 'protected', 'static', 'override',
        'true', 'false',
    ],
    python: [
        'def', 'class', 'self', 'return', 'if', 'elif', 'else', 'for', 'while',
        'import', 'from', 'as', 'try', 'except', 'finally', 'with', 'yield',
        'lambda', 'pass', 'raise', 'and', 'or', 'not', 'in', 'is', 'None',
        'True', 'False', 'global', 'nonlocal', 'assert', 'del', 'break', 'continue',
        'async', 'await', 'match', 'case',
    ],
    go: [
        'func', 'package', 'import', 'type', 'struct', 'interface', 'const', 'var',
        'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break',
        'continue', 'go', 'defer', 'select', 'chan', 'map', 'make', 'new', 'nil',
        'true', 'false', 'iota', 'fallthrough', 'goto',
    ],
    rust: [
        'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
        'pub', 'mod', 'use', 'crate', 'self', 'super', 'return', 'if', 'else',
        'for', 'while', 'loop', 'match', 'break', 'continue', 'async', 'await',
        'move', 'ref', 'where', 'type', 'as', 'in', 'unsafe', 'extern', 'dyn',
        'true', 'false', 'Some', 'None', 'Ok', 'Err',
    ],
    java: [
        'public', 'private', 'protected', 'static', 'final', 'abstract', 'class',
        'interface', 'extends', 'implements', 'new', 'return', 'if', 'else',
        'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch',
        'finally', 'throw', 'throws', 'import', 'package', 'void', 'this', 'super',
        'true', 'false', 'null', 'instanceof', 'synchronized', 'volatile',
    ],
    shell: [
        'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done',
        'case', 'esac', 'function', 'return', 'exit', 'export', 'local',
        'readonly', 'set', 'unset', 'source', 'echo', 'printf',
    ],
};

const LANG_TYPES: Record<string, string[]> = {
    _common: ['string', 'number', 'boolean', 'void', 'any', 'undefined', 'null', 'int', 'float', 'bool', 'object'],
    go: ['string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'float32', 'float64', 'bool', 'byte', 'rune', 'error', 'any'],
    rust: ['i8', 'i16', 'i32', 'i64', 'i128', 'u8', 'u16', 'u32', 'u64', 'u128', 'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec', 'Box', 'Option', 'Result', 'usize', 'isize'],
    python: ['int', 'float', 'str', 'bool', 'list', 'dict', 'tuple', 'set', 'None', 'bytes', 'object'],
    java: ['int', 'long', 'short', 'byte', 'float', 'double', 'char', 'boolean', 'String', 'Object', 'void', 'Integer', 'Long', 'Double', 'Boolean'],
};

const COMMENT_PATTERNS: Record<string, RegExp> = {
    _default: /^\s*(\/\/|#|--|;;)/,
    python: /^\s*#/,
    shell: /^\s*#/,
    go: /^\s*\/\//,
    rust: /^\s*\/\//,
    java: /^\s*\/\//,
    html: /^\s*<!--/,
    css: /^\s*\/\*/,
};

/**
 * 语法高亮渲染（主题感知，支持多语言）
 */
function renderSyntax(line: string, lang: string, theme: Theme): string {
    if (!lang) return chalk.hex(theme.text)(line);

    const normalizedLang = lang.toLowerCase().replace(/^(ts|tsx|jsx)$/, 'typescript')
        .replace(/^(py)$/, 'python').replace(/^(sh|bash|zsh)$/, 'shell')
        .replace(/^(rs)$/, 'rust');

    let result = line;

    // Comments
    const commentPattern = COMMENT_PATTERNS[normalizedLang] ?? COMMENT_PATTERNS._default;
    if (commentPattern.test(result)) {
        return chalk.hex(theme.syntaxComment).italic(result);
    }

    // Strings
    result = result.replace(
        /("[^"]*"|'[^']*'|`[^`]*`)/g,
        (m) => chalk.hex(theme.syntaxString)(m),
    );

    // Numbers
    result = result.replace(
        /\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g,
        (m) => chalk.hex(theme.syntaxNumber)(m),
    );

    // Function calls (word followed by parenthesis)
    result = result.replace(
        /\b([a-zA-Z_]\w*)\s*(?=\()/g,
        (m) => chalk.hex(theme.syntaxFunction ?? theme.accent)(m),
    );

    // Keywords
    const keywords = LANG_KEYWORDS[normalizedLang] ?? LANG_KEYWORDS._common;
    const kwPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
    result = result.replace(kwPattern, (m) => chalk.hex(theme.syntaxKeyword)(m));

    // Types
    const types = LANG_TYPES[normalizedLang] ?? LANG_TYPES._common;
    const typePattern = new RegExp(`\\b(${types.join('|')})\\b`, 'g');
    result = result.replace(typePattern, (m) => chalk.hex(theme.syntaxType)(m));

    // Decorators / attributes (@)
    result = result.replace(/@(\w+)/g, (m) => chalk.hex(theme.syntaxComment)(m));

    return result;
}

/**
 * 强制替换 ANSI 背景色为主题背景色
 * 参考 OpenCode: internal/tui/styles/background.go
 */
export function forceReplaceBackground(ansi: string, bgHex: string): string {
    return ansi.replace(/\x1b\[4[0-9]m/g, chalk.bgHex(bgHex)('').split('').slice(0, -1).join(''));
}

/**
 * Word wrap preserving ANSI escape codes.
 * Breaks long lines at word boundaries without splitting escape sequences.
 */
function wordWrap(text: string, maxWidth: number): string {
    if (maxWidth <= 0) return text;

    // Strip ANSI to measure visible length
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const visibleLen = stripAnsi(text).length;
    if (visibleLen <= maxWidth) return text;

    // Simple break: find last space within visible range
    const words = text.split(/( +)/);
    const lines: string[] = [];
    let currentLine = '';
    let currentVisLen = 0;

    for (const word of words) {
        const wordVisLen = stripAnsi(word).length;
        if (currentVisLen + wordVisLen > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word.trimStart();
            currentVisLen = stripAnsi(currentLine).length;
        } else {
            currentLine += word;
            currentVisLen += wordVisLen;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
}

/**
 * 渲染 Diff 文本
 */
export function renderDiff(diff: string, width: number = 80): string {
    const theme = getTheme();
    return diff
        .split('\n')
        .map(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                return chalk.hex(theme.diffAdded)(line);
            }
            if (line.startsWith('-') && !line.startsWith('---')) {
                return chalk.hex(theme.diffRemoved)(line);
            }
            if (line.startsWith('@@')) {
                return chalk.hex(theme.info)(line);
            }
            return chalk.hex(theme.diffContext)(line);
        })
        .join('\n');
}
