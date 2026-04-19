import type { AgentRunStatus } from '../../../application/agent/index.js';

export const TERMINAL_INLINE_EVENT_MAX_LENGTH = 160;
export const TERMINAL_INLINE_OUTPUT_MAX_LENGTH = 240;

export interface TerminalStreamingBlockState {
    open: boolean;
    atLineStart: boolean;
    wroteContent: boolean;
}

export interface TerminalToolOutputState {
    tool: string;
    buffer: string;
    sawPartial: boolean;
}

export function createTerminalStreamingBlockState(): TerminalStreamingBlockState {
    return {
        open: false,
        atLineStart: true,
        wroteContent: false,
    };
}

export function createTerminalToolOutputState(tool: string): TerminalToolOutputState {
    return {
        tool,
        buffer: '',
        sawPartial: false,
    };
}

export function writeConversationBlock(
    stdout: NodeJS.WriteStream,
    header: string,
    content: string,
): void {
    stdout.write(`${header}\n`);
    const lines = content.length > 0 ? content.split('\n') : [''];
    for (const line of lines) {
        stdout.write(`  ${line}\n`);
    }
    stdout.write('\n');
}

export function truncateTerminalInlineText(text: string, maxLength = TERMINAL_INLINE_EVENT_MAX_LENGTH): string {
    if (maxLength <= 0) return '';
    if (text.length <= maxLength) return text;
    if (maxLength === 1) return '…';
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatTerminalInlineValue(value: unknown, maxLength = TERMINAL_INLINE_EVENT_MAX_LENGTH): string {
    const raw = (() => {
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    })();

    const normalized = raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
    return truncateTerminalInlineText(normalized, maxLength);
}

export function splitTerminalOutputBuffer(buffer: string, flush = false): { lines: string[]; rest: string } {
    const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = normalized.split('\n');
    if (flush) {
        const lines = parts.at(-1) === '' ? parts.slice(0, -1) : parts;
        return { lines, rest: '' };
    }
    return {
        lines: parts.slice(0, -1),
        rest: parts.at(-1) ?? '',
    };
}

export function ensureStreamingConversationBlock(
    stdout: NodeJS.WriteStream,
    header: string,
    state: TerminalStreamingBlockState,
): void {
    if (state.open) {
        return;
    }
    stdout.write(`${header}\n`);
    state.open = true;
    state.atLineStart = true;
    state.wroteContent = false;
}

export function writeStreamingConversationChunk(
    stdout: NodeJS.WriteStream,
    header: string,
    state: TerminalStreamingBlockState,
    text: string,
): void {
    if (!text) {
        return;
    }

    ensureStreamingConversationBlock(stdout, header, state);
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (const character of normalized) {
        if (state.atLineStart) {
            stdout.write('  ');
        }
        stdout.write(character);
        state.wroteContent = true;
        state.atLineStart = character === '\n';
    }
}

export function finishStreamingConversationBlock(
    stdout: NodeJS.WriteStream,
    state: TerminalStreamingBlockState,
): void {
    if (!state.open) {
        return;
    }

    if (!state.wroteContent) {
        stdout.write('  \n\n');
    } else {
        if (!state.atLineStart) {
            stdout.write('\n');
        }
        stdout.write('\n');
    }

    state.open = false;
    state.atLineStart = true;
    state.wroteContent = false;
}

export function writeTerminalInlineNote(stdout: NodeJS.WriteStream, note: string): void {
    stdout.write(`${note}\n`);
}

export function getTerminalToolKey(event: { provider: string; tool: string }): string {
    return `${event.provider}:${event.tool}`;
}

export function shouldShowToolArgs(args: unknown): boolean {
    if (args == null) {
        return false;
    }
    if (typeof args === 'string') {
        return args.trim().length > 0;
    }
    if (Array.isArray(args)) {
        return args.length > 0;
    }
    if (typeof args === 'object') {
        return Object.keys(args as Record<string, unknown>).length > 0;
    }
    return true;
}

export function formatTerminalStatusNote(
    status: AgentRunStatus,
    hasAnnouncedThinking: boolean,
): string | null {
    if (status === 'thinking' && !hasAnnouncedThinking) {
        return '[thinking]';
    }
    if (status === 'awaiting-approval') {
        return '[approval] waiting for input';
    }
    return null;
}
