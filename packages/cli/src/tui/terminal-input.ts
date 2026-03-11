const BRACKETED_PASTE_MARKER_RE = /(?:\u001B)?\[(?:200|201)~/g;
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const MULTI_LINE_WHITESPACE_RE = /\r\n?|\t/g;
const SINGLE_LINE_WHITESPACE_RE = /\n/g;
const CONTROL_CHAR_KEEP_NEWLINES_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
/** 过滤 C1 控制字符、未配对 UTF-16 代理对，避免 IME 异常序列导致闪退 */
function safeCodepoints(s: string): string {
    try {
        let out = '';
        for (let i = 0; i < s.length; i++) {
            const code = s.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF) {
                const next = s.charCodeAt(i + 1);
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    out += s[i]! + s[i + 1];
                    i++;
                }
                continue;
            }
            if (code >= 0xDC00 && code <= 0xDFFF) continue;
            if (code >= 0x80 && code <= 0x9F) continue;
            out += s[i];
        }
        return out;
    } catch {
        return '';
    }
}

function safeString(s: unknown): string {
    if (typeof s === 'string') return s;
    if (s == null) return '';
    try {
        return String(s);
    } catch {
        return '';
    }
}

export function sanitizeMultiLineTerminalInput(input: string): string {
    try {
        const s = safeString(input);
        if (s.length === 0) return s;
        return safeCodepoints(
            s
                .replace(BRACKETED_PASTE_MARKER_RE, '')
                .replace(ANSI_ESCAPE_RE, '')
                .replace(MULTI_LINE_WHITESPACE_RE, (match) => (match === '\t' ? ' ' : '\n'))
                .replace(CONTROL_CHAR_KEEP_NEWLINES_RE, ''),
        );
    } catch {
        return '';
    }
}

export function sanitizeSingleLineTerminalInput(input: string): string {
    try {
        return sanitizeMultiLineTerminalInput(input).replace(SINGLE_LINE_WHITESPACE_RE, ' ');
    } catch {
        return '';
    }
}
