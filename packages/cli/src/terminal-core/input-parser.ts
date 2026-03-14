export type ParsedKeyName =
    | 'up'
    | 'down'
    | 'left'
    | 'right'
    | 'home'
    | 'end'
    | 'pageup'
    | 'pagedown'
    | 'enter'
    | 'tab'
    | 'backspace'
    | 'delete'
    | 'escape';

export interface ParsedKeyInputEvent {
    type: 'key';
    key: ParsedKeyName | string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    raw: string;
}

export interface ParsedTextInputEvent {
    type: 'text';
    text: string;
    raw: string;
}

export interface ParsedPasteInputEvent {
    type: 'paste';
    text: string;
    raw: string;
}

export interface ParsedMouseInputEvent {
    type: 'mouse';
    kind: 'press' | 'release' | 'drag' | 'scroll';
    button: 'left' | 'middle' | 'right' | 'wheelUp' | 'wheelDown' | 'unknown';
    x: number;
    y: number;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    raw: string;
}

export type TerminalInputEvent =
    | ParsedKeyInputEvent
    | ParsedTextInputEvent
    | ParsedPasteInputEvent
    | ParsedMouseInputEvent;

// 长序列放前面，避免被短序列抢先匹配（如 \x1b[1;2A 要在 \x1b[A 前）
const keySequences: Array<{ sequence: string; key: ParsedKeyName; shift?: boolean }> = [
    { sequence: '\x1b[1;2A', key: 'up', shift: true },
    { sequence: '\x1b[1;2B', key: 'down', shift: true },
    { sequence: '\x1b[1;2C', key: 'right', shift: true },
    { sequence: '\x1b[1;2D', key: 'left', shift: true },
    { sequence: '\x1b[A', key: 'up' },
    { sequence: '\x1b[B', key: 'down' },
    { sequence: '\x1b[C', key: 'right' },
    { sequence: '\x1b[D', key: 'left' },
    { sequence: '\x1b[H', key: 'home' },
    { sequence: '\x1b[F', key: 'end' },
    { sequence: '\x1b[1~', key: 'home' },
    { sequence: '\x1b[4~', key: 'end' },
    { sequence: '\x1b[7~', key: 'home' },
    { sequence: '\x1b[8~', key: 'end' },
    { sequence: '\x1b[5~', key: 'pageup' },
    { sequence: '\x1b[6~', key: 'pagedown' },
    { sequence: '\x1b[3~', key: 'delete' },
    { sequence: '\x1b[Z', key: 'tab', shift: true },
    { sequence: '\x1bOH', key: 'home' },
    { sequence: '\x1bOF', key: 'end' },
];

function normalizeText(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

function decodeMouseButton(code: number): ParsedMouseInputEvent['button'] {
    if (code === 64) return 'wheelUp';
    if (code === 65) return 'wheelDown';

    switch (code & 3) {
        case 0: return 'left';
        case 1: return 'middle';
        case 2: return 'right';
        default: return 'unknown';
    }
}

function decodeMouseKind(code: number, action: 'M' | 'm'): ParsedMouseInputEvent['kind'] {
    if (code === 64 || code === 65) {
        return 'scroll';
    }
    if (action === 'm') {
        return 'release';
    }
    if ((code & 32) === 32) {
        return 'drag';
    }
    return 'press';
}

/** SGR 格式：\x1b[<code;x;yM (1006) */
function parseMouseSequenceSGR(raw: string): { event: ParsedMouseInputEvent; length: number } | null {
    const match = raw.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (!match) {
        return null;
    }

    const code = Number.parseInt(match[1] ?? '0', 10);
    const event: ParsedMouseInputEvent = {
        type: 'mouse',
        kind: decodeMouseKind(code, (match[4] ?? 'M') as 'M' | 'm'),
        button: decodeMouseButton(code),
        x: Number.parseInt(match[2] ?? '1', 10),
        y: Number.parseInt(match[3] ?? '1', 10),
        shift: Boolean(code & 4),
        alt: Boolean(code & 8),
        ctrl: Boolean(code & 16),
        raw: match[0],
    };

    return {
        event,
        length: match[0].length,
    };
}

/** 旧式 xterm 格式：\x1b[M + 3 字节 (Cb Cx Cy)，Cb = button+32，部分终端只发这种 */
function parseMouseSequenceLegacy(raw: string): { event: ParsedMouseInputEvent; length: number } | null {
    if (raw.length < 6 || !raw.startsWith('\x1b[M')) {
        return null;
    }
    const b = raw.charCodeAt(3) - 32;
    const x = raw.charCodeAt(4) - 32;
    const y = raw.charCodeAt(5) - 32;
    const event: ParsedMouseInputEvent = {
        type: 'mouse',
        kind: b === 64 || b === 65 ? 'scroll' : 'press',
        button: decodeMouseButton(b),
        x: Math.max(1, x),
        y: Math.max(1, y),
        raw: raw.slice(0, 6),
    };
    return { event, length: 6 };
}

function parseMouseSequence(raw: string): { event: ParsedMouseInputEvent; length: number } | null {
    return parseMouseSequenceSGR(raw) ?? parseMouseSequenceLegacy(raw);
}

export function parseInputChunk(input: string): TerminalInputEvent[] {
    const events: TerminalInputEvent[] = [];
    let cursor = 0;

    while (cursor < input.length) {
        if (input.startsWith('\x1b[200~', cursor)) {
            const end = input.indexOf('\x1b[201~', cursor + 6);
            if (end !== -1) {
                const raw = input.slice(cursor, end + 6);
                const text = normalizeText(input.slice(cursor + 6, end));
                events.push({ type: 'paste', text, raw });
                cursor = end + 6;
                continue;
            }
        }

        const mouse = parseMouseSequence(input.slice(cursor));
        if (mouse) {
            events.push(mouse.event);
            cursor += mouse.length;
            continue;
        }

        const matchedKey = keySequences.find((entry) => input.startsWith(entry.sequence, cursor));
        if (matchedKey) {
            events.push({
                type: 'key',
                key: matchedKey.key,
                ...(matchedKey.shift ? { shift: true } : {}),
                raw: matchedKey.sequence,
            });
            cursor += matchedKey.sequence.length;
            continue;
        }

        const char = input[cursor]!;
        if (char === '\r' || char === '\n') {
            events.push({ type: 'key', key: 'enter', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\t') {
            events.push({ type: 'key', key: 'tab', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x7f' || char === '\b') {
            events.push({ type: 'key', key: 'backspace', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x15') {
            events.push({ type: 'key', key: 'delete-to-line-start', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x1b') {
            const next = input[cursor + 1];
            if (next && next !== '[') {
                events.push({ type: 'key', key: next, alt: true, raw: input.slice(cursor, cursor + 2) });
                cursor += 2;
                continue;
            }
            events.push({ type: 'key', key: 'escape', raw: char });
            cursor += 1;
            continue;
        }

        let end = cursor;
        while (end < input.length) {
            const candidate = input[end]!;
            if (candidate === '\x1b' || candidate === '\r' || candidate === '\n' || candidate === '\t' || candidate === '\x7f' || candidate === '\b') {
                break;
            }
            end += 1;
        }
        const text = input.slice(cursor, end);
        events.push({ type: 'text', text, raw: text });
        cursor = end;
    }

    return events;
}

const MAX_ESCAPE_LENGTH = 24;

/**
 * 解析输入并返回未消费的尾部（可能是不完整的转义序列），用于跨 chunk 缓冲。
 * 当尾部以 \x1b 开头且可能是未收齐的鼠标/按键序列时，放入 rest，下次与新区块拼接后再解析。
 */
export function parseInputChunkWithRest(input: string): { events: TerminalInputEvent[]; rest: string } {
    const events: TerminalInputEvent[] = [];
    let cursor = 0;

    while (cursor < input.length) {
        if (input.startsWith('\x1b[200~', cursor)) {
            const end = input.indexOf('\x1b[201~', cursor + 6);
            if (end !== -1) {
                const raw = input.slice(cursor, end + 6);
                const text = normalizeText(input.slice(cursor + 6, end));
                events.push({ type: 'paste', text, raw });
                cursor = end + 6;
                continue;
            }
            return { events, rest: input.slice(cursor) };
        }

        const mouse = parseMouseSequence(input.slice(cursor));
        if (mouse) {
            events.push(mouse.event);
            cursor += mouse.length;
            continue;
        }

        const matchedKey = keySequences.find((entry) => input.startsWith(entry.sequence, cursor));
        if (matchedKey) {
            events.push({
                type: 'key',
                key: matchedKey.key,
                ...(matchedKey.shift ? { shift: true } : {}),
                raw: matchedKey.sequence,
            });
            cursor += matchedKey.sequence.length;
            continue;
        }

        const char = input[cursor]!;
        if (char === '\r' || char === '\n') {
            events.push({ type: 'key', key: 'enter', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\t') {
            events.push({ type: 'key', key: 'tab', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x7f' || char === '\b') {
            events.push({ type: 'key', key: 'backspace', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x15') {
            events.push({ type: 'key', key: 'delete-to-line-start', raw: char });
            cursor += 1;
            continue;
        }
        if (char === '\x1b') {
            const rest = input.slice(cursor);
            if (rest.length === 1) {
                return { events, rest };
            }
            if (rest.length <= MAX_ESCAPE_LENGTH) {
                if (rest.startsWith('\x1b[<') || rest.startsWith('\x1b[M') || rest.startsWith('\x1b[') || rest.startsWith('\x1bO')) {
                    return { events, rest };
                }
            }
            const next = input[cursor + 1];
            if (next && next !== '[') {
                events.push({ type: 'key', key: next, alt: true, raw: input.slice(cursor, cursor + 2) });
                cursor += 2;
                continue;
            }
            events.push({ type: 'key', key: 'escape', raw: char });
            cursor += 1;
            continue;
        }

        let end = cursor;
        while (end < input.length) {
            const candidate = input[end]!;
            if (candidate === '\x1b' || candidate === '\r' || candidate === '\n' || candidate === '\t' || candidate === '\x7f' || candidate === '\b') {
                break;
            }
            end += 1;
        }
        const text = input.slice(cursor, end);
        events.push({ type: 'text', text, raw: text });
        cursor = end;
    }

    return { events, rest: '' };
}
