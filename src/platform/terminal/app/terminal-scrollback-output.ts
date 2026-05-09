import type { AgentRunStatus } from '../../../application/agent/index.js';
import {
    findPotentialRestartedAssistantAnswerIndex,
    removeRepeatedAssistantSections,
} from '../../../application/chat/response-cleanup.js';

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
    suppressOutput: boolean;
}

export interface TerminalAssistantTextState {
    raw: string;
    visible: string;
}

export function createTerminalStreamingBlockState(): TerminalStreamingBlockState {
    return {
        open: false,
        atLineStart: true,
        wroteContent: false,
    };
}

export function createTerminalAssistantTextState(): TerminalAssistantTextState {
    return {
        raw: '',
        visible: '',
    };
}

export function appendTerminalAssistantTextDelta(
    state: TerminalAssistantTextState,
    delta: string,
): string {
    if (!delta) {
        return '';
    }

    state.raw += delta;
    return updateTerminalAssistantVisibleText(
        state,
        holdBackPotentialRestartTail(removeRepeatedAssistantSections(state.raw)),
    );
}

export function completeTerminalAssistantText(
    state: TerminalAssistantTextState,
    finalText?: string,
): string {
    if (finalText !== undefined) {
        state.raw = finalText;
    }

    return updateTerminalAssistantVisibleText(
        state,
        removeRepeatedAssistantSections(state.raw),
    );
}

function updateTerminalAssistantVisibleText(
    state: TerminalAssistantTextState,
    nextVisible: string,
): string {
    if (nextVisible.startsWith(state.visible)) {
        const nextVisibleDelta = nextVisible.slice(state.visible.length);
        state.visible = nextVisible;
        return nextVisibleDelta;
    }

    if (state.visible.startsWith(nextVisible)) {
        state.visible = nextVisible;
        return '';
    }

    return '';
}

function holdBackPotentialRestartTail(content: string): string {
    const restartIndex = findPotentialRestartedAssistantAnswerIndex(content);
    if (restartIndex === undefined) {
        return content;
    }

    return removeTerminalDanglingRestartLeadIn(content.slice(0, restartIndex)).trimEnd();
}

function removeTerminalDanglingRestartLeadIn(content: string): string {
    return content.replace(
        /\s*(?:欢迎随时(?:告诉我|指定)|欢迎继续提问|请告诉我[！!]?|需要我帮你[:：]?|还需要我帮你[:：]?)[\s\p{P}\p{S}]*$/u,
        '',
    );
}

export function createTerminalToolOutputState(tool: string): TerminalToolOutputState {
    return {
        tool,
        buffer: '',
        sawPartial: false,
        suppressOutput: shouldSuppressTerminalToolOutput(tool),
    };
}

export function shouldSuppressTerminalToolOutput(tool: string): boolean {
    return QUIET_SUCCESS_TOOL_OUTPUTS.has(tool) || tool.startsWith('lsp_');
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

const QUIET_SUCCESS_TOOL_OUTPUTS = new Set([
    'read_any_file',
    'read_file',
    'search_code',
    'grep_content',
    'glob_files',
    'inspect_github_repo',
    'list_files',
    'sourcegraph',
    'diagnostics',
    'todoread',
]);

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

export function formatTerminalUsageNote(input: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
}): string {
    const segments = [
        '[usage]',
        input.model,
        `prompt=${input.promptTokens}`,
        `completion=${input.completionTokens}`,
        `total=${input.totalTokens}`,
    ];

    if (input.cost !== undefined) {
        segments.push(`cost=$${formatTerminalUsageCost(input.cost)}`);
    }

    return segments.join(' ');
}

function formatTerminalUsageCost(cost: number): string {
    if (!Number.isFinite(cost)) {
        return '0';
    }
    if (cost === 0) {
        return '0';
    }
    if (Math.abs(cost) >= 0.01) {
        return cost.toFixed(2);
    }
    if (Math.abs(cost) >= 0.001) {
        return cost.toFixed(4);
    }
    return cost.toFixed(6);
}
