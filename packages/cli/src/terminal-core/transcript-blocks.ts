import stringWidth from 'string-width';
import type { TerminalTranscriptEntry } from './app-state.js';

export interface TranscriptCodeBlock {
    id: string;
    startLine: number;
    endLine: number;
    text: string;
}

function wrapPlainLine(line: string, width: number): string[] {
    if (line.length === 0) return [''];
    const rows: string[] = [];
    let current = '';
    let currentWidth = 0;
    for (const char of line) {
        const charWidth = Math.max(1, stringWidth(char));
        if (currentWidth + charWidth > width && current.length > 0) {
            rows.push(current);
            current = char;
            currentWidth = charWidth;
            continue;
        }
        current += char;
        currentWidth += charWidth;
    }
    rows.push(current);
    return rows;
}

/** 将 content 按 ``` 拆成文本段与代码块。 */
function parseContentSegments(content: string): Array<{ type: 'text'; text: string } | { type: 'code'; language: string; text: string }> {
    const segments: Array<{ type: 'text'; text: string } | { type: 'code'; language: string; text: string }> = [];
    const parts = content.split('```');
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!;
        if (i % 2 === 0) {
            if (part.length > 0) segments.push({ type: 'text', text: part });
            continue;
        }
        const firstNewline = part.indexOf('\n');
        const language = firstNewline === -1 ? part.trim() : part.slice(0, firstNewline).trim();
        const codeText = firstNewline === -1 ? '' : part.slice(firstNewline + 1).replace(/\n$/, '');
        segments.push({ type: 'code', language, text: codeText });
    }
    return segments;
}

export interface EntryLineRange {
    entryId: string;
    startLine: number;
    endLine: number;
}

export interface RebuildTranscriptResult {
    lines: string[];
    codeBlocks: TranscriptCodeBlock[];
    entryLineRanges: EntryLineRange[];
}

export function rebuildTranscriptWithCodeBlocks(
    entries: TerminalTranscriptEntry[],
    contentWidth: number,
): RebuildTranscriptResult {
    const lines: string[] = [];
    const codeBlocks: TranscriptCodeBlock[] = [];
    const entryLineRanges: EntryLineRange[] = [];
    const width = Math.max(10, contentWidth - 2);

    for (const entry of entries) {
        const startLine = lines.length;
        const header = entry.role === 'user'
            ? 'You'
            : entry.role === 'assistant'
                ? 'XQoder'
                : entry.role === 'tool'
                    ? 'Tool'
                    : 'System';

        let content = entry.content;
        if (entry.role === 'tool' || entry.role === 'system') {
            const lineCount = content.length > 0 ? content.split('\n').length : 0;
            content = lineCount > 0 ? `(输出已折叠，共 ${lineCount} 行)` : '(无输出)';
        }

        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(header);

        const segments = parseContentSegments(content);
        let blockIndex = 0;

        for (const seg of segments) {
            if (seg.type === 'text') {
                const bodyLines = seg.text.split('\n').flatMap((line) => wrapPlainLine(line, width));
                for (const bodyLine of bodyLines) {
                    lines.push(`  ${bodyLine}`);
                }
                continue;
            }
            const codeLines = seg.text.split('\n');
            const codeBlockId = `${entry.id}:block:${blockIndex}`;
            blockIndex += 1;
            const startLine = lines.length;
            lines.push(`  \`\`\`${seg.language || ''}`);
            for (const codeLine of codeLines) {
                const wrapped = wrapPlainLine(codeLine, width - 2);
                for (const w of wrapped) {
                    lines.push(`  ${w}`);
                }
            }
            lines.push(`  \`\`\``);
            const endLine = lines.length - 1;
            codeBlocks.push({
                id: codeBlockId,
                startLine,
                endLine,
                text: seg.text,
            });
        }

        if (entry.attachments && entry.attachments.length > 0) {
            lines.push(`  ${entry.attachments.map((item) => `[${item}]`).join(' ')}`);
        }
        entryLineRanges.push({ entryId: entry.id, startLine, endLine: lines.length - 1 });
    }

    return { lines, codeBlocks, entryLineRanges };
}
