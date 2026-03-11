import { formatAttachmentDisplayLabel } from './attachments.js';
import { renderMarkdown } from './markdown.js';
import type { ChatMessage } from './message.js';

export interface TranscriptSlice {
    visible: string[];
    showAbove: boolean;
    showBelow: boolean;
}

const lineCache = new Map<string, string[]>();
const MAX_CACHE_SIZE = 300;
const ANSI_ESCAPE_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;
const BLOCK_INDENT = '  ';

function stripAnsi(input: string): string {
    return input.replace(ANSI_ESCAPE_RE, '');
}

function truncateLine(line: string, width: number): string {
    if (width <= 0) {
        return '';
    }

    if (line.length <= width) {
        return line;
    }

    if (width <= 3) {
        return '.'.repeat(width);
    }

    return `${line.slice(0, width - 3)}...`;
}

function wrapPlainLine(line: string, width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (line.length === 0) {
        return [''];
    }

    const rows: string[] = [];
    let offset = 0;
    while (offset < line.length) {
        rows.push(line.slice(offset, offset + safeWidth));
        offset += safeWidth;
    }
    return rows;
}

function buildIndentedPlainText(input: string, width: number): string[] {
    const contentWidth = Math.max(1, width - BLOCK_INDENT.length);
    return input.split('\n').flatMap((line) => wrapPlainLine(line, contentWidth).map((row) => `${BLOCK_INDENT}${row}`));
}

function buildAttachmentLines(attachments: string[], width: number): string[] {
    const contentWidth = Math.max(1, width - BLOCK_INDENT.length);
    const joined = attachments.map((attachment) => `[${formatAttachmentDisplayLabel(attachment)}]`).join(' ');
    return wrapPlainLine(joined, contentWidth).map((row) => `${BLOCK_INDENT}${row}`);
}

function buildAssistantContentLines(message: ChatMessage, width: number): string[] {
    const maxStreamingRender = 1500;
    const content = message.isStreaming && message.content.length > maxStreamingRender
        ? message.content.slice(-maxStreamingRender)
        : message.content;

    try {
        return collapseTranscriptBlankLines(
            stripAnsi(renderMarkdown(content, width))
            .split('\n')
            .map((line) => line.length > 0 ? `${BLOCK_INDENT}${truncateLine(line, Math.max(1, width - BLOCK_INDENT.length))}` : ''),
        );
    } catch {
        return buildIndentedPlainText(content, width);
    }
}

function collapseTranscriptBlankLines(lines: string[]): string[] {
    const collapsed: string[] = [];
    let previousBlank = false;

    for (const line of lines) {
        const isBlank = line.trim().length === 0;
        if (isBlank && previousBlank) {
            continue;
        }
        collapsed.push(line);
        previousBlank = isBlank;
    }

    while (collapsed.length > 0 && collapsed[0]?.trim().length === 0) {
        collapsed.shift();
    }
    while (collapsed.length > 0 && collapsed.at(-1)?.trim().length === 0) {
        collapsed.pop();
    }

    return collapsed;
}

function getMessageHeader(message: ChatMessage): string {
    switch (message.type) {
        case 'user':
            return 'You';
        case 'assistant':
            return message.isStreaming ? 'XQoder ...' : 'XQoder';
        case 'tool':
            return `Tool: ${message.toolName ?? 'tool'}${message.toolSuccess === false ? ' (failed)' : ' (ok)'}`;
        case 'system':
            return 'System';
        default:
            return 'Message';
    }
}

function buildMessageCacheKey(message: ChatMessage, contentWidth: number): string {
    return [
        message.id,
        message.type,
        String(contentWidth),
        message.toolName ?? '',
        message.toolSuccess === false ? 'failed' : 'ok',
        message.attachments?.join('\u0001') ?? '',
        message.content,
    ].join('\u0000');
}

export function buildMessageBlockLines(message: ChatMessage, contentWidth: number): string[] {
    const header = truncateLine(getMessageHeader(message), contentWidth);

    let bodyLines: string[];
    switch (message.type) {
        case 'assistant':
            bodyLines = buildAssistantContentLines(message, contentWidth);
            break;
        case 'tool':
        case 'system':
        case 'user':
        default:
            bodyLines = buildIndentedPlainText(message.content, contentWidth);
            break;
    }

    if (message.type === 'user' && message.attachments && message.attachments.length > 0) {
        bodyLines = [...bodyLines, ...buildAttachmentLines(message.attachments, contentWidth)];
    }

    return [header, ...bodyLines];
}

function getMessageLines(message: ChatMessage, contentWidth: number): string[] {
    if (!message.isStreaming) {
        const cacheKey = buildMessageCacheKey(message, contentWidth);
        const cached = lineCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const lines = buildMessageBlockLines(message, contentWidth);
        if (lineCache.size > MAX_CACHE_SIZE) {
            const firstKey = lineCache.keys().next().value;
            if (firstKey) {
                lineCache.delete(firstKey);
            }
        }
        lineCache.set(cacheKey, lines);
        return lines;
    }

    return buildMessageBlockLines(message, contentWidth);
}

export function buildTranscriptLines(messages: ChatMessage[], width: number): string[] {
    const contentWidth = Math.max(width - 4, 20);
    const result: string[] = [];

    for (const message of messages) {
        if (result.length > 0) {
            result.push('');
        }
        result.push(...getMessageLines(message, contentWidth));
    }

    return result;
}

export function sliceTranscriptLines(
    lines: string[],
    topLine: number,
    height: number,
): TranscriptSlice {
    const safeTopLine = Math.max(0, Math.min(topLine, Math.max(0, lines.length - 1)));
    const showAbove = safeTopLine > 0;
    const visibleHeight = Math.max(1, height);
    const provisionalVisible = lines.slice(safeTopLine, safeTopLine + visibleHeight);
    const showBelow = safeTopLine + provisionalVisible.length < lines.length;

    return {
        visible: provisionalVisible,
        showAbove,
        showBelow,
    };
}

export function alignTranscriptToBottom(lines: string[], height: number): string[] {
    const safeHeight = Math.max(0, height);
    if (lines.length >= safeHeight) {
        return lines;
    }

    return [
        ...Array.from({ length: safeHeight - lines.length }, () => ''),
        ...lines,
    ];
}
