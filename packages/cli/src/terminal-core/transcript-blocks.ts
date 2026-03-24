import stringWidth from 'string-width';
import type { TerminalTranscriptEntry } from './app-state.js';
import { rustTui } from './rust-tui.js';

export interface TranscriptCodeBlock {
    id: string;
    startLine: number;
    endLine: number;
    language: string;
    text: string;
}

function wrapPlainLine(line: string, width: number): string[] {
    if (line.length === 0) return [''];
    const rustWrapped = rustTui.wrapText(line, width);
    if (rustWrapped && rustWrapped.length > 0) {
        return rustWrapped;
    }
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

function extractToolName(entry: TerminalTranscriptEntry): string {
    const idMatch = entry.id.match(/:tool:([^:]+):/);
    if (idMatch?.[1]) {
        return idMatch[1];
    }
    const first = entry.content.trim().split(/\s+/)[0] ?? '';
    return first;
}

function extractContextSource(entry: TerminalTranscriptEntry): string {
    const content = entry.content;
    const pathMatch = content.match(/([A-Za-z]:[\\/][^\s`"']+|\/[A-Za-z0-9._\-/]+)/);
    if (pathMatch?.[1]) {
        return pathMatch[1];
    }
    const queryMatch = content.match(/query:\s*([^\n]+)/i);
    if (queryMatch?.[1]) {
        return queryMatch[1].trim();
    }
    const firstLine = content.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
    return firstLine ?? 'unknown';
}

function buildContextGroupSummary(reads: number, uniqueSources: number): string {
    const base = rustTui.contextGroupLabel(reads);
    if (uniqueSources <= 0) {
        return base;
    }
    if (uniqueSources === reads) {
        return `${base} · ${uniqueSources} sources`;
    }
    return `${base} · ${uniqueSources} unique sources`;
}

function buildContextGroupDetails(cluster: TerminalTranscriptEntry[], maxItems = 4): string[] {
    const items: string[] = [];
    const seen = new Set<string>();
    for (const entry of cluster) {
        const item = `${extractToolName(entry)} ${extractContextSource(entry)}`.trim();
        if (seen.has(item)) {
            continue;
        }
        seen.add(item);
        items.push(item);
    }
    if (items.length <= maxItems) {
        return items;
    }
    const hidden = items.length - maxItems;
    return [...items.slice(0, maxItems), `... ${hidden} more`];
}

function groupContextReadEntries(entries: TerminalTranscriptEntry[]): TerminalTranscriptEntry[] {
    const grouped: TerminalTranscriptEntry[] = [];
    let index = 0;
    while (index < entries.length) {
        const current = entries[index]!;
        if (current.role !== 'tool') {
            grouped.push(current);
            index += 1;
            continue;
        }
        const toolName = extractToolName(current);
        if (!rustTui.isContextReadTool(toolName)) {
            grouped.push(current);
            index += 1;
            continue;
        }

        const cluster: TerminalTranscriptEntry[] = [current];
        let cursor = index + 1;
        while (cursor < entries.length) {
            const candidate = entries[cursor]!;
            if (candidate.role !== 'tool') {
                break;
            }
            const nextTool = extractToolName(candidate);
            if (!rustTui.isContextReadTool(nextTool)) {
                break;
            }
            cluster.push(candidate);
            cursor += 1;
        }

        if (cluster.length > 1) {
            const uniqueSources = new Set(cluster.map((entry) => `${extractToolName(entry)}::${extractContextSource(entry)}`)).size;
            const detailLines = buildContextGroupDetails(cluster);
            grouped.push({
                ...current,
                id: `${current.id}:context-group:${cluster.length}`,
                content: [buildContextGroupSummary(cluster.length, uniqueSources), ...detailLines].join('\n'),
                isStreaming: false,
                success: true,
            });
        } else {
            grouped.push(current);
        }
        index = cursor;
    }
    return grouped;
}

function mapToolAction(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes('read') || lower.includes('find') || lower.includes('search')) return 'Reading';
    if (lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('replace')) return 'Editing';
    if (lower.includes('bash') || lower.includes('shell') || lower.includes('exec') || lower.includes('command')) return 'Running';
    if (lower.includes('test') || lower.includes('build')) return 'Running';
    return 'Running';
}

function summarizeToolOutput(content: string): string | undefined {
    const trimmed = content.trim();
    if (!trimmed) return undefined;
    const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
    const bytes = Buffer.byteLength(trimmed, 'utf8');
    const kb = bytes / 1024;
    if (lines.length >= 4 || trimmed.length > 240) {
        return `${lines.length} lines · ${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
    }
    const cleaned = trimmed.replace(/\s+/g, ' ');
    return cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned;
}

function formatTimestamp(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) {
        return '';
    }
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function isDiffLikeText(content: string): boolean {
    const text = content.trim();
    if (!text) return false;
    return text.includes('@@ ')
        || text.includes('diff --git')
        || text.includes('*** Begin Patch')
        || /(^|\n)[+-][^\n]+/.test(text);
}

function foldDiffContext(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inHunk = false;
    let contextRun: string[] = [];

    const flushContext = (): void => {
        if (!inHunk || contextRun.length <= 6) {
            out.push(...contextRun);
            contextRun = [];
            return;
        }
        const keepHead = contextRun.slice(0, 2);
        const keepTail = contextRun.slice(-2);
        const hidden = contextRun.length - keepHead.length - keepTail.length;
        out.push(...keepHead);
        out.push(`... ${hidden} unchanged lines (folded, press Enter)`);
        out.push(...keepTail);
        contextRun = [];
    };

    for (const line of lines) {
        if (line.startsWith('@@')) {
            flushContext();
            inHunk = true;
            out.push(line);
            continue;
        }
        if (!inHunk) {
            out.push(line);
            continue;
        }
        if (line.startsWith(' ')) {
            contextRun.push(line);
            continue;
        }
        flushContext();
        out.push(line);
    }
    flushContext();
    return out.join('\n');
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
    entryLineStarts: number[];
    entryLineEnds: number[];
    entryHeights: number[];
    entryCumHeights: number[];
    entryTotalLines: number;
}

export function rebuildTranscriptWithCodeBlocks(
    entries: TerminalTranscriptEntry[],
    contentWidth: number,
    options: {
        shouldFoldDiffBlock?: (blockId: string) => boolean;
        shouldCollapseToolEntry?: (entryId: string) => boolean;
        promoteTrailingToolEventsBeforeAssistant?: boolean;
    } = {},
): RebuildTranscriptResult {
    const lines: string[] = [];
    const codeBlocks: TranscriptCodeBlock[] = [];
    const entryLineRanges: EntryLineRange[] = [];
    const width = Math.max(10, contentWidth - 2);

    const sourceEntries = (() => {
        if (!options.promoteTrailingToolEventsBeforeAssistant) {
            return entries;
        }
        const reordered: TerminalTranscriptEntry[] = [];
        for (let index = 0; index < entries.length; index += 1) {
            const current = entries[index]!;
            if (current.role !== 'assistant') {
                reordered.push(current);
                continue;
            }
            const followingTools: TerminalTranscriptEntry[] = [];
            const followingOthers: TerminalTranscriptEntry[] = [];
            let cursor = index + 1;
            while (cursor < entries.length) {
                const candidate = entries[cursor]!;
                if (candidate.role === 'assistant' || candidate.role === 'user') {
                    break;
                }
                if (candidate.role === 'tool') {
                    followingTools.push(candidate);
                } else {
                    followingOthers.push(candidate);
                }
                cursor += 1;
            }
            if (followingTools.length === 0) {
                reordered.push(current);
                continue;
            }
            reordered.push(...followingTools);
            reordered.push(current);
            reordered.push(...followingOthers);
            index = cursor - 1;
        }
        return reordered;
    })();

    const displayEntries = groupContextReadEntries(sourceEntries);

    for (const entry of displayEntries) {
        const startLine = lines.length;
        const header = entry.role === 'user'
            ? (formatTimestamp(entry.timestamp) ? `you  ${formatTimestamp(entry.timestamp)}` : 'you')
            : entry.role === 'assistant'
                ? (formatTimestamp(entry.timestamp) ? `xqoder  ${formatTimestamp(entry.timestamp)}` : 'xqoder')
                : entry.role === 'tool'
                    ? ''
                    : 'System';

        let content = entry.content;
        if (entry.role === 'tool') {
            if (entry.id.includes(':ui:rollback-actions:')) {
                // UI 专用：保留/撤销按钮行，保持原样渲染
            } else
            if (entry.id.includes(':meta:phase:')) {
                content = `Thinking: ${content}`;
            } else if (entry.id.includes(':context-group:')) {
                const rows = content
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                const summary = rows[0] ?? 'Gathered context';
                const details = rows.slice(1);
                const collapsed = options.shouldCollapseToolEntry?.(entry.id) ?? false;
                const marker = '◈';
                content = collapsed || details.length === 0
                    ? `${marker} ${summary}`
                    : `${marker} ${summary}\n${details.map((line) => `  ${line}`).join('\n')}`;
            } else {
                const toolName = extractToolName(entry) || 'tool';
                const action = mapToolAction(toolName);
                const stateText = entry.isStreaming
                    ? `${action} ${toolName}`
                    : entry.success === false
                        ? `Failed ${toolName}`
                        : `Completed ${toolName}`;
                // Week4：workflow 进度块必须原样展示（不能被 “N lines · KB” 摘要折叠）
                if (toolName === 'workflow' || content.includes('Step ') || content.includes('▏')) {
                    content = `→ ${stateText}\n\n${content}`;
                } else
                if (isDiffLikeText(content)) {
                    const diffBody = content.includes('```') ? content : `\`\`\`diff\n${content}\n\`\`\``;
                    content = `→ ${stateText}\n\n${diffBody}`;
                } else {
                    const outputSummary = summarizeToolOutput(content);
                    content = outputSummary && outputSummary !== toolName
                        ? `→ ${stateText}\n↳ ${outputSummary}`
                        : `→ ${stateText}`;
                }
            }
        } else if (entry.role === 'system') {
            const lineCount = content.length > 0 ? content.split('\n').length : 0;
            content = lineCount > 0 ? `(output collapsed, ${lineCount} lines)` : '(no output)';
        }

        if (lines.length > 0) {
            lines.push('');
        }
        if (header.length > 0) {
            lines.push(header);
        }

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
            const codeBlockId = `${entry.id}:block:${blockIndex}`;
            blockIndex += 1;
            const shouldFoldDiff = (seg.language || '').toLowerCase() === 'diff'
                && (options.shouldFoldDiffBlock ? options.shouldFoldDiffBlock(codeBlockId) : true);
            const codeText = shouldFoldDiff ? foldDiffContext(seg.text) : seg.text;
            const codeLines = codeText.split('\n');
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
                language: seg.language,
                text: codeText,
            });
        }

        if (entry.attachments && entry.attachments.length > 0) {
            lines.push(`  ${entry.attachments.map((item) => `[${item}]`).join(' ')}`);
        }
        entryLineRanges.push({ entryId: entry.id, startLine, endLine: lines.length - 1 });
    }

    const entryLineStarts = entryLineRanges.map((range) => range.startLine);
    const entryLineEnds = entryLineRanges.map((range) => range.endLine);
    const rustCache = rustTui.buildEntryCache(entryLineStarts, entryLineEnds);
    const entryHeights = rustCache?.heights ?? entryLineRanges.map((range) => Math.max(0, range.endLine - range.startLine + 1));
    const entryCumHeights = rustCache?.cumHeights
        ?? entryHeights.reduce<number[]>((acc, value) => {
            const prev = acc.length > 0 ? acc[acc.length - 1]! : 0;
            acc.push(prev + value);
            return acc;
        }, []);
    const entryTotalLines = rustCache?.totalLines
        ?? (entryCumHeights.length > 0 ? entryCumHeights[entryCumHeights.length - 1]! : 0);

    return {
        lines,
        codeBlocks,
        entryLineRanges,
        entryLineStarts,
        entryLineEnds,
        entryHeights,
        entryCumHeights,
        entryTotalLines,
    };
}
