import type { AppEvent } from '@xqoder/protocol';
import type { LLMMessage } from '@xqoder/shared';
import { CostCalculator, getContextWindow, configManager } from '@xqoder/shared';
import type { TerminalAppState, TerminalTranscriptEntry } from './app-state.js';
import { getEditorViewModel } from './editor-model.js';
import type { TerminalCoreEvent } from './types.js';
import { rebuildTranscriptWithCodeBlocks } from './transcript-blocks.js';
import { getApprovalStatusHint, getOverlayStatusHint, getQuestionStatusHint } from './interaction-protocol.js';
import * as path from 'node:path';
import { rustTui } from './rust-tui.js';
import { getTodaySessionStatsCached, markTodaySessionStatsDirty } from '../services/today-session-stats.js';

const SIDEBAR_RATIO = 0.30;
const SIDEBAR_MIN_WIDTH = 22;
const SIDEBAR_MAX_WIDTH = 46;

function buildLspStatusLines(cwd: string | undefined): string[] {
    const dir = cwd ?? process.cwd();
    const loaded = (() => {
        try {
            return configManager.load({ cwd: dir });
        } catch {
            return configManager.load();
        }
    })();
    const servers = (loaded.lsp?.servers ?? []).slice(0, 3);
    if (servers.length === 0) return ['○ disabled'];
    return servers.map((s) => `${s.enabled === false ? '○' : '●'} ${s.name}`);
}

function containsCjk(text: string): boolean {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(text);
}

function sanitizeAssistantText(content: string): string {
    // Remove emoji and emoji joiners to keep assistant replies professional.
    return content.replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, '');
}

function normalizeApprovalSummary(summary: string): string {
    if (!containsCjk(summary)) return summary;
    return 'Permission request';
}

function normalizeApprovalPayload(payload: string | undefined): string | undefined {
    if (!payload) return payload;
    if (!containsCjk(payload)) return payload;
    return 'Review request details and choose Allow or Deny.';
}

function normalizeQuestionText(header: string | undefined, question: string): { header?: string; question: string; notice: string } {
    const headerText = header && !containsCjk(header) ? header : undefined;
    const questionText = containsCjk(question)
        ? 'Allow access to the requested resource?'
        : question;
    const notice = headerText ? `${headerText}: ${questionText}` : questionText;
    return { ...(headerText ? { header: headerText } : {}), question: questionText, notice };
}

function getTranscriptWidth(state: TerminalAppState, sidebarVisible: boolean): number {
    const innerWidth = Math.max(20, state.size.width - 2);
    const sidebarWidth = sidebarVisible
        ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(innerWidth * SIDEBAR_RATIO)))
        : 0;
    const mainWidth = Math.max(20, innerWidth - sidebarWidth);
    return Math.max(10, mainWidth - 2);
}

/** Transcript area height (rows) for viewport math. Matches renderer layout. */
export function getTranscriptHeight(state: TerminalAppState): number {
    // 必须与 renderer/layout.rs 保持一致，否则滚动最大 topLine 会计算错，
    // 表现为“看不到更下面的 AI 回答 / 下滑无效”。
    //
    // Rust renderer 固定 input_lines=2，因此：
    // header_h = 1
    // input_total_h = (2 + 2) = 4
    // footer_h = 2
    // Rust renderer 侧会把真实 rows 做 “-1” 兜底（见 packages/renderer/src/renderer.rs 的 real_rows）。
    // 因此 renderer 实际 messages_h = (rows - 1) - 1 - 4 - 2 = rows - 8
    return Math.max(5, state.size.height - 8);
}

export function getProjectedTranscriptViewportHeight(
    state: Pick<TerminalAppState, 'size' | 'viewport'>,
    fallbackHeight?: number,
): number {
    const projectedHeight = Math.trunc(state.viewport?.viewportHeight ?? 0);
    if (projectedHeight > 0) {
        return projectedHeight;
    }
    if (typeof fallbackHeight === 'number' && Number.isFinite(fallbackHeight) && fallbackHeight > 0) {
        return Math.max(1, Math.trunc(fallbackHeight));
    }
    return getTranscriptHeight(state as TerminalAppState);
}

export function getProjectedLogViewportHeight(
    state: Pick<TerminalAppState, 'logViewport'>,
    fallbackHeight = 1,
): number {
    const projectedHeight = Math.trunc(state.logViewport?.viewportHeight ?? 0);
    if (projectedHeight > 0) {
        return projectedHeight;
    }
    return Math.max(1, Math.trunc(fallbackHeight));
}

export function getProjectedActiveViewportHeight(
    state: Pick<TerminalAppState, 'size' | 'page' | 'viewport' | 'logViewport'>,
    options: { chatFallbackHeight?: number; logFallbackHeight?: number } = {},
): number {
    if (state.page === 'logs') {
        return getProjectedLogViewportHeight(state, options.logFallbackHeight ?? 1);
    }
    return getProjectedTranscriptViewportHeight(state, options.chatFallbackHeight);
}


function buildSidebar(state: TerminalAppState): TerminalAppState['sidebar'] {
    const sections: TerminalAppState['sidebar'] = [
        {
            title: 'Context',
            lines: [
                state.cwd ?? '(no cwd)',
                state.model ? `Model: ${state.model}` : 'Model: unknown',
                state.agent ? `Agent: ${state.agent}` : 'Agent: unknown',
            ],
        },
        {
            title: 'Session',
            lines: [state.activeSessionId ?? 'not started', `Mode: ${state.interactionMode}`],
        },
    ];
    if (state.modifiedFiles && state.modifiedFiles.length > 0) {
        sections.push({
            title: 'Modified',
            lines: state.modifiedFiles.map((p) => p.split(/[/\\]/).pop() ?? p),
        });
    }

    if (state.pendingApproval) {
        sections.push({
            title: 'Approval',
            lines: [
                state.pendingApproval.summary,
                state.pendingApproval.payload ?? '1: Allow once  2: Always allow (session)  3: Deny',
            ],
        });
    }

    if (state.pendingQuestion) {
        const questionLineRaw = state.pendingQuestion.header
            ? `${state.pendingQuestion.header}: ${state.pendingQuestion.question}`
            : state.pendingQuestion.question;
        const questionLine = containsCjk(questionLineRaw)
            ? 'Permission request: allow this action?'
            : questionLineRaw;
        sections.push({
            title: 'Question',
            lines: [
                questionLine,
                `${state.pendingQuestion.options.length} options${state.pendingQuestion.multiple ? ' (multi)' : ''}`,
            ],
        });
    }

    return sections;
}

function estimateContextTokens(state: TerminalAppState): number {
    const transcriptChars = state.transcriptEntries.reduce((total, entry) => total + entry.content.length, 0);
    const editorChars = state.editor.value.length;
    const attachmentChars = state.transcriptEntries.reduce((total, entry) => {
        const attachmentLabelLength = (entry.attachments ?? []).reduce((sum, attachment) => sum + attachment.length, 0);
        return total + attachmentLabelLength;
    }, 0);
    const totalChars = transcriptChars + editorChars + attachmentChars;
    return Math.max(0, Math.ceil(totalChars / 4));
}

function estimateCostUSD(state: TerminalAppState, estimatedTokens: number): number {
    const calc = new CostCalculator();
    // 粗估：把全部 tokens 当作 input（这里只是 UI 预估；真实成本来自 provider usage）
    return calc.calculate(state.model ?? '', estimatedTokens, 0).usd;
}

function formatContextCostSegment(state: TerminalAppState): string {
    const estimatedTokens = estimateContextTokens(state);
    const estimatedCost = estimateCostUSD(state, estimatedTokens);
    const tokenText = estimatedTokens >= 1000
        ? `${(estimatedTokens / 1000).toFixed(1)}K`
        : String(estimatedTokens);
    return `Context: ${tokenText}, Cost: $${estimatedCost.toFixed(2)}`;
}

function resolveDisplayNotice(state: Pick<TerminalAppState, 'runtimeNotice' | 'uiNotice'>): string | undefined {
    return state.uiNotice ?? state.runtimeNotice;
}

function buildRendererStatus(
    state: Pick<TerminalAppState, 'runtimeStatus' | 'runtimeNotice' | 'uiNotice' | 'model'>,
    estimatedTokens: number,
): TerminalAppState['rendererStatus'] {
    const contextMax = Math.max(1, getContextWindow(state.model ?? '') ?? 200000);
    const contextUsed = Math.max(0, Math.min(contextMax, Math.trunc(estimatedTokens)));
    const displayNotice = resolveDisplayNotice(state);
    const thinking = state.runtimeStatus === 'thinking';
    const text = (() => {
        if (thinking) return 'Thinking...';
        if (displayNotice) return displayNotice;
        switch (state.runtimeStatus) {
            case 'running-tool':
                return 'Running tool';
            case 'awaiting-approval':
                return 'Awaiting approval';
            case 'error':
                return 'Error';
            case 'done':
                return 'Done';
            case 'idle':
            default:
                return 'Ready';
        }
    })();
    return {
        thinking,
        text,
        contextUsed,
        contextMax,
    };
}

function buildStatusItems(state: TerminalAppState): TerminalAppState['statusItems'] {
    const pulseGlyph = ['.', 'o', 'O', 'o'][state.runtimePulseFrame % 4] ?? '.';
    const runtimeLabel = state.runtimeStatus === 'running-tool'
        ? `Running ${pulseGlyph}`
        : state.runtimeStatus === 'thinking'
            ? `Thinking ${pulseGlyph}`
            : state.runtimeStatus;
    const modeLabel = `Mode: ${state.interactionMode.toUpperCase()}`;
    return [
        { text: runtimeLabel },
        { text: modeLabel, tone: 'accent' as const },
        { text: formatContextCostSegment(state), tone: 'muted' as const },
        ...(resolveDisplayNotice(state) ? [{ text: resolveDisplayNotice(state)!, tone: 'accent' as const }] : []),
        ...(state.model ? [{ text: state.model, tone: 'muted' as const }] : []),
        ...(state.transcriptCodeBlocks.length > 0 ? [{ text: 'Alt+C / Ctrl+Shift+C copy code block', tone: 'muted' as const }] : []),
        ...(state.transcriptEntries.length > 0 ? [{ text: 'y copy message  Y copy code block', tone: 'muted' as const }] : []),
        ...(process.platform === 'darwin' ? [{ text: '⌘+C copy selection', tone: 'muted' as const }] : []),
        ...(state.editor.value.length > 0 ? [{ text: 'Ctrl+U delete to line start', tone: 'muted' as const }] : []),
        { text: process.platform === 'darwin' ? '⌘+V paste' : 'Ctrl+V paste', tone: 'muted' as const },
        ...(state.pendingApproval
            ? [{
                text: getApprovalStatusHint(),
                tone: 'accent' as const,
            }]
            : []),
        ...(state.pendingQuestion
            ? [{
                text: getQuestionStatusHint(state.pendingQuestion.multiple),
                tone: 'accent' as const,
            }]
            : []),
        ...(state.overlay
            ? [{
                text: getOverlayStatusHint(state.overlay) ?? 'overlay active',
                tone: 'muted' as const,
            }]
            : []),
    ];
}

export function withDerivedChrome(state: TerminalAppState): TerminalAppState {
    const notice = resolveDisplayNotice(state);
    const sidebar = buildSidebar(state);
    const width = getTranscriptWidth(state, sidebar.length > 0);
    const options = {
        shouldFoldDiffBlock: (blockId: string) => !state.diffExpandedBlockIds.includes(blockId),
        shouldCollapseToolEntry: (entryId: string) => entryId.includes(':context-group:') && !state.expandedContextGroupIds.includes(entryId),
        promoteTrailingToolEventsBeforeAssistant: state.runtimeStatus === 'thinking'
            || state.runtimeStatus === 'running-tool'
            || state.runtimeStatus === 'awaiting-approval',
    };

    // Week3：避免每次事件都全量重建 transcript（长会话会越来越慢）。
    // 对于高频更新（assistant streaming/tool output），只重建最后一段 entries，
    // 复用前缀的行与高度缓存，保证 commitState 的开销基本恒定。
    const TAIL_REBUILD_ENTRIES = 50;
    const canTailRebuild =
        state.transcriptEntries.length > TAIL_REBUILD_ENTRIES
        && state.transcriptLines.length > 0
        && state.transcriptEntryLineRanges.length === state.transcriptEntries.length;

    const deriveFromEntries = (entries: TerminalTranscriptEntry[]) =>
        rebuildTranscriptWithCodeBlocks(entries, width, options);

    const derived = (() => {
        if (!canTailRebuild) {
            return deriveFromEntries(state.transcriptEntries);
        }

        const cutIndex = Math.max(0, state.transcriptEntries.length - TAIL_REBUILD_ENTRIES);
        const cutStartLine = state.transcriptEntryLineRanges[cutIndex]?.startLine ?? 0;
        const prefixLines = state.transcriptLines.slice(0, cutStartLine);

        const tailEntries = state.transcriptEntries.slice(cutIndex);
        const tail = deriveFromEntries(tailEntries);

        const mergedLines = [...prefixLines, ...tail.lines];
        const offset = prefixLines.length;
        const mergedRanges = [
            ...state.transcriptEntryLineRanges.slice(0, cutIndex),
            ...tail.entryLineRanges.map((range) => ({
                entryId: range.entryId,
                startLine: range.startLine + offset,
                endLine: range.endLine + offset,
            })),
        ];

        // 重新计算缓存（用 Rust 的 buildEntryCache，避免手动累加误差）
        const starts = mergedRanges.map((r) => r.startLine);
        const ends = mergedRanges.map((r) => r.endLine);
        const cache = rustTui.buildEntryCache(starts, ends);

        return {
            lines: mergedLines,
            codeBlocks: tail.codeBlocks, // 仅用于当前 viewport 的复制/定位，尾部足够覆盖活跃区域
            entryLineRanges: mergedRanges,
            entryLineStarts: cache?.heights ? starts : starts,
            entryLineEnds: cache?.heights ? ends : ends,
            entryHeights: cache?.heights ?? mergedRanges.map((r) => Math.max(0, r.endLine - r.startLine + 1)),
            entryCumHeights: cache?.cumHeights
                ?? (cache?.heights
                    ? []
                    : mergedRanges.reduce<number[]>((acc, r) => {
                        const prev = acc.length > 0 ? acc[acc.length - 1]! : 0;
                        acc.push(prev + Math.max(0, r.endLine - r.startLine + 1));
                        return acc;
                    }, [])),
            entryTotalLines: cache?.totalLines ?? mergedLines.length,
        };
    })();

    const {
        lines: transcriptLines,
        codeBlocks: transcriptCodeBlocks,
        entryLineRanges: transcriptEntryLineRanges,
        entryLineStarts: transcriptEntryLineStarts,
        entryLineEnds: transcriptEntryLineEnds,
        entryHeights: transcriptEntryHeights,
        entryCumHeights: transcriptEntryCumHeights,
        entryTotalLines: transcriptEntryTotalLines,
    } = derived;

    const estimatedTokens = estimateContextTokens(state);
    const costUsdThis = estimateCostUSD(state, estimatedTokens);
    const today = getTodaySessionStatsCached();
    const costUsdToday = today.usd;
    const todayMessageCount = today.messages;
    const lspStatusLines = buildLspStatusLines(state.cwd);
    const { dockerLines, dockerUrl } = extractDockerSandboxFromTranscript(state.transcriptEntries);

    const nextState = {
        ...state,
        notice,
        transcriptLines,
        transcriptCodeBlocks,
        transcriptEntryLineRanges,
        transcriptEntryLineStarts,
        transcriptEntryLineEnds,
        transcriptEntryHeights,
        transcriptEntryCumHeights,
        transcriptEntryTotalLines,
        sidebar,
        statusItems: state.statusItems,
        rendererStatus: state.rendererStatus,
        costUsdThis,
        costUsdToday,
        todayMessageCount,
        lspStatusLines,
        dockerLines,
        dockerUrl,
    };
    return {
        ...nextState,
        rendererStatus: buildRendererStatus(nextState, estimatedTokens),
        statusItems: buildStatusItems(nextState),
    };
}

function extractDockerSandboxFromTranscript(entries: TerminalTranscriptEntry[]): { dockerLines: string[]; dockerUrl: string } {
    // 解析最近一次 Docker 沙盒输出（如果还没跑起来，会返回空数组/空 URL）。
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const content = String(entries[i]?.content ?? '');
        const idx = content.indexOf('Docker Sandbox');
        if (idx < 0) continue;

        const tail = content.slice(idx);
        const lines = tail.split('\n').map((l) => l.trimEnd());
        const picked: string[] = [];

        // 取“Docker Sandbox + 接下来的少量行”，直到遇到空行/结束。
        for (const line of lines) {
            const trimmed = line.trim();
            if (picked.length > 0 && trimmed.length === 0) break;
            picked.push(trimmed);
            if (picked.length >= 4) break;
        }

        const portLine = lines.find((l) => /Port\\s+\\d+\\s*→\\s*localhost:\\d+/i.test(l));
        let dockerUrl = '';
        if (portLine) {
            const m = portLine.match(/Port\\s+(\\d+)\\s*→\\s*localhost:(\\d+)/i);
            if (m) {
                const hostPort = m[2] ? Number(m[2]) : Number(m[1]);
                if (Number.isFinite(hostPort) && hostPort > 0) {
                    dockerUrl = `http://localhost:${hostPort}`;
                }
            }
        }

        return { dockerLines: picked.filter((l) => l.length > 0), dockerUrl };
    }

    return { dockerLines: [], dockerUrl: '' };
}

function upsertTranscriptEntry(entries: TerminalTranscriptEntry[], nextEntry: TerminalTranscriptEntry): TerminalTranscriptEntry[] {
    const index = entries.findIndex((entry) => entry.id === nextEntry.id);
    if (index === -1) {
        return [...entries, nextEntry];
    }
    const next = [...entries];
    next[index] = { ...next[index]!, ...nextEntry };
    return next;
}

function appendTranscriptEntry(entries: TerminalTranscriptEntry[], nextEntry: TerminalTranscriptEntry): TerminalTranscriptEntry[] {
    return [...entries, nextEntry];
}

function appendPhaseEntry(
    entries: TerminalTranscriptEntry[],
    sessionId: string,
    timestamp: number,
    phase: string,
): TerminalTranscriptEntry[] {
    const normalized = phase.trim();
    if (!normalized) return entries;
    const last = entries[entries.length - 1];
    if (last && last.id.includes(':meta:phase:') && last.content.trim() === normalized) {
        return entries;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.role !== 'tool') {
            break;
        }
        if (entry.id.includes(':meta:phase:') && entry.content.trim() === normalized) {
            return entries;
        }
    }
    return appendTranscriptEntry(entries, {
        id: `${sessionId}:meta:phase:${timestamp}`,
        role: 'tool',
        content: normalized,
        isStreaming: false,
    });
}

function phaseForToolCall(toolName: string): string {
    const lower = toolName.toLowerCase();
    if (lower.includes('read') || lower.includes('grep') || lower.includes('glob') || lower.includes('search') || lower.includes('fetch')) {
        return `Reading with ${toolName}`;
    }
    if (lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('replace')) {
        return `Editing with ${toolName}`;
    }
    if (lower.includes('test') || lower.includes('build') || lower.includes('bash') || lower.includes('exec') || lower.includes('shell')) {
        return `Running ${toolName}`;
    }
    return `Running ${toolName}`;
}

function isAbsolutePath(path: string): boolean {
    if (!path) return false;
    if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:[\\/]/.test(path)) {
        return true;
    }
    return false;
}

function extractTargetPathFromArgs(args: unknown): string | undefined {
    if (!args || typeof args !== 'object') return undefined;
    const record = args as Record<string, unknown>;
    const candidate = typeof record.path === 'string'
        ? record.path
        : typeof record.filePath === 'string'
            ? record.filePath
            : typeof record.file_path === 'string'
                ? record.file_path
                : typeof record.target === 'string'
                    ? record.target
                    : typeof record.content === 'string' && typeof record.path === 'undefined'
                        ? undefined
                        : undefined;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function findLatestToolEntry(entries: TerminalTranscriptEntry[], toolName: string): number {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.role === 'tool' && entry.id.includes(`:${toolName}:`) && entry.isStreaming) {
            return index;
        }
    }
    return -1;
}

function findLatestToolEntryAny(entries: TerminalTranscriptEntry[], toolName: string): number {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.role === 'tool' && entry.id.includes(`:${toolName}:`)) {
            return index;
        }
    }
    return -1;
}

function extractDiffBody(text: string): string | undefined {
    const fenceMatch = text.match(/```diff\n([\s\S]*?)\n```/);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }
    if (text.includes('*** Begin Patch') || text.includes('diff --git') || /(^|\n)[+-][^\n]+/.test(text)) {
        return text.trim();
    }
    return undefined;
}

function parsePatchedFiles(diffBody: string): string[] {
    const files = new Set<string>();
    const lines = diffBody.split('\n');
    for (const line of lines) {
        const patchHeader = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/);
        if (patchHeader?.[1]) {
            files.add(patchHeader[1].trim());
            continue;
        }
        const diffHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (diffHeader?.[2]) {
            files.add(diffHeader[2].trim());
            continue;
        }
        const plusHeader = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
        if (plusHeader?.[1] && plusHeader[1] !== '/dev/null') {
            files.add(plusHeader[1].trim());
        }
    }
    return [...files].slice(0, 6);
}

function countDiffAddsRemoves(diffBody: string): { adds: number; removes: number } {
    let adds = 0;
    let removes = 0;
    for (const line of diffBody.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) adds += 1;
        if (line.startsWith('-')) removes += 1;
    }
    return { adds, removes };
}

function firstUsefulOutputLine(output: string): string | undefined {
    const line = output
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.length > 0);
    return line ? (line.length > 120 ? `${line.slice(0, 117)}...` : line) : undefined;
}

function mergeToolContent(tool: string, current: string, nextOutput: string, partial: boolean): string {
    if (partial) {
        return `${current}${nextOutput}`;
    }
    const lower = tool.toLowerCase();
    const isEditTool = lower.includes('patch') || lower.includes('replace') || lower.includes('write') || lower.includes('edit');
    const existingDiff = extractDiffBody(current);
    const nextDiff = extractDiffBody(nextOutput);
    if (isEditTool && existingDiff && !nextDiff) {
        const summary = firstUsefulOutputLine(nextOutput);
        return summary ? `${current}\n\n→ ${summary}` : current;
    }
    return nextOutput;
}

function buildPatchedSummaryCard(tool: string, content: string): string | undefined {
    const lower = tool.toLowerCase();
    const isEditTool = lower.includes('patch') || lower.includes('replace') || lower.includes('write') || lower.includes('edit');
    if (!isEditTool) return undefined;
    const diffBody = extractDiffBody(content);
    if (!diffBody) return undefined;

    const files = parsePatchedFiles(diffBody);
    const { adds, removes } = countDiffAddsRemoves(diffBody);
    const counts = `${adds > 0 ? `+${adds}` : '+0'} ${removes > 0 ? `-${removes}` : '-0'}`;
    const title = files.length <= 1
        ? `Patched ${files[0] ?? 'file'} (${counts})`
        : `Patched ${files.length} files (${counts})`;
    const fileLines = files.length > 0
        ? files.map((file) => `• ${file}`).join('\n')
        : '';
    const snippet = diffBody.split('\n').slice(0, 24).join('\n').trim();
    if (!snippet) return fileLines ? `${title}\n${fileLines}` : title;
    return [
        title,
        ...(fileLines ? [fileLines] : []),
        '',
        '```diff',
        snippet,
        '```',
    ].join('\n');
}

function normalizeDiffPreviewText(raw: string, maxLines = 120): string {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    return lines.slice(0, maxLines).join('\n').trim();
}

function buildToolDiffPreview(tool: string, args: unknown): string | undefined {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return undefined;
    }
    const record = args as Record<string, unknown>;
    const lower = tool.toLowerCase();

    if (lower.includes('apply_patch') || lower.includes('patch')) {
        const patchText = typeof record.patchText === 'string'
            ? record.patchText
            : typeof record.patch === 'string'
                ? record.patch
                : undefined;
        if (!patchText) return undefined;
        const preview = normalizeDiffPreviewText(patchText);
        if (!preview) return undefined;
        return `\`\`\`diff\n${preview}\n\`\`\``;
    }

    if (lower.includes('search_replace') || lower.includes('replace')) {
        const oldText = typeof record.oldString === 'string'
            ? record.oldString
            : typeof record.old_text === 'string'
                ? record.old_text
                : undefined;
        const newText = typeof record.newString === 'string'
            ? record.newString
            : typeof record.new_text === 'string'
                ? record.new_text
                : undefined;
        if (!oldText && !newText) return undefined;
        const oldLines = normalizeDiffPreviewText(oldText ?? '').split('\n').filter((line) => line.length > 0).slice(0, 40);
        const newLines = normalizeDiffPreviewText(newText ?? '').split('\n').filter((line) => line.length > 0).slice(0, 40);
        const body = [
            ...oldLines.map((line) => `-${line}`),
            ...newLines.map((line) => `+${line}`),
        ].join('\n').trim();
        if (!body) return undefined;
        return `\`\`\`diff\n${body}\n\`\`\``;
    }

    if (lower.includes('write') || lower.includes('edit')) {
        const filePath = typeof record.path === 'string'
            ? record.path
            : typeof record.filePath === 'string'
                ? record.filePath
                : typeof record.file_path === 'string'
                    ? record.file_path
                    : 'file';
        const content = typeof record.content === 'string'
            ? record.content
            : typeof record.text === 'string'
                ? record.text
                : typeof record.value === 'string'
                    ? record.value
                    : undefined;
        if (!content) return undefined;
        const plusLines = normalizeDiffPreviewText(content)
            .split('\n')
            .slice(0, 60)
            .map((line) => `+${line}`)
            .join('\n');
        if (!plusLines) return undefined;
        return `\`\`\`diff\n--- a/${filePath}\n+++ b/${filePath}\n${plusLines}\n\`\`\``;
    }

    return undefined;
}

function attachmentsFromEvent(event: Extract<AppEvent, { type: 'message.started' | 'message.completed' }>): string[] | undefined {
    const values = (event.message.attachments ?? [])
        .map((attachment) => attachment.filePath ?? attachment.fileName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return values.length > 0 ? values : undefined;
}

function buildHistoryEntries(messages: LLMMessage[]): TerminalTranscriptEntry[] {
    return messages.flatMap<TerminalTranscriptEntry>((message, index) => {
        if (message.role === 'system') {
            return [];
        }

        const attachments = (message.attachments ?? [])
            .map((attachment) => attachment.filePath ?? attachment.fileName)
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

        return [{
            id: `history:${index}`,
            role: message.role === 'tool' ? 'tool' : message.role,
            content: message.content,
            ...(attachments.length > 0 ? { attachments } : {}),
        }];
    });
}

export function restoreTerminalHistory(
    state: TerminalAppState,
    options: { sessionId: string; title?: string; cwd?: string; messages: LLMMessage[] },
): TerminalAppState {
    return withDerivedChrome({
        ...state,
        activeSessionId: options.sessionId,
        title: options.title ?? state.title,
        cwd: options.cwd ?? state.cwd,
        runtimeStatus: 'idle',
        runtimeNotice: undefined,
        uiNotice: options.messages.length > 0 ? `restored ${options.messages.length} messages` : 'empty session',
        pendingApproval: undefined,
        approvalInput: undefined,
        pendingQuestion: undefined,
        questionInput: undefined,
        transcriptEntries: buildHistoryEntries(options.messages),
    });
}

function assertDomainToViewOneWay(event: AppEvent): void {
    if (event.source !== 'ui') {
        return;
    }
    throw new Error(
        `[runtime-bridge] Domain→View mapping violated: ${event.type} cannot originate from UI source`,
    );
}

type UiToolFeedbackEvent = Extract<TerminalCoreEvent, {
    type: 'ui.tool.feedback.called' | 'ui.tool.feedback.output' | 'ui.tool.feedback.completed';
}>;

type NoticeScope = 'runtime' | 'ui';

function applyScopedNotice(
    state: TerminalAppState,
    scope: NoticeScope,
    notice: string | undefined,
): Pick<TerminalAppState, 'runtimeNotice' | 'uiNotice'> {
    if (scope === 'runtime') {
        return {
            runtimeNotice: notice,
            uiNotice: undefined,
        };
    }
    return {
        runtimeNotice: state.runtimeNotice,
        uiNotice: notice,
    };
}

function reduceToolCalledViewState(
    state: TerminalAppState,
    event: { sessionId: string; timestamp: number; tool: string; args: import('@xqoder/protocol').JsonValue },
    noticeScope: NoticeScope,
): TerminalAppState {
    const preview = buildToolDiffPreview(event.tool, event.args);
    const isWriteOperation = /(write|edit|patch|replace)/i.test(event.tool);
    const targetPath = extractTargetPathFromArgs(event.args);
    const hasAbsolutePath = targetPath ? isAbsolutePath(targetPath) : false;
    if (isWriteOperation && !hasAbsolutePath) {
        const hintMessage = targetPath
            ? `Target path is not absolute: ${targetPath}. Provide an absolute path to prevent miswrites.`
            : 'Write operation requested but target path is not absolute or not specified. Provide an absolute path.';
        return withDerivedChrome({
            ...state,
            runtimeStatus: 'awaiting-approval',
            ...applyScopedNotice(state, noticeScope, hintMessage),
            transcriptEntries: appendTranscriptEntry(
                appendPhaseEntry(state.transcriptEntries, event.sessionId, event.timestamp, 'Awaiting absolute path'),
                {
                    id: `${event.sessionId}:tool:${event.tool}:path-hint:${event.timestamp}`,
                    role: 'tool',
                    content: hintMessage,
                    isStreaming: false,
                    success: false,
                },
            ),
        });
    }
    return withDerivedChrome({
        ...state,
        runtimeStatus: 'running-tool',
        runtimePulseFrame: 0,
        ...applyScopedNotice(state, noticeScope, `tool ${event.tool}`),
        transcriptEntries: appendTranscriptEntry(
            appendPhaseEntry(state.transcriptEntries, event.sessionId, event.timestamp, phaseForToolCall(event.tool)),
            {
                id: `${event.sessionId}:tool:${event.tool}:${event.timestamp}`,
                role: 'tool',
                content: preview ? `${event.tool}\n\n${preview}` : `${event.tool}`,
                isStreaming: true,
            },
        ),
    });
}

function reduceToolOutputViewState(
    state: TerminalAppState,
    event: { sessionId: string; timestamp: number; tool: string; output: string; partial?: boolean },
    noticeScope: NoticeScope,
): TerminalAppState {
    const toolIndex = findLatestToolEntry(state.transcriptEntries, event.tool);
    if (toolIndex === -1) {
        return withDerivedChrome({
            ...state,
            runtimeStatus: 'running-tool',
            ...applyScopedNotice(state, noticeScope, event.partial ? `tool ${event.tool} streaming` : `tool ${event.tool} output`),
            transcriptEntries: appendTranscriptEntry(
                appendPhaseEntry(state.transcriptEntries, event.sessionId, event.timestamp, phaseForToolCall(event.tool)),
                {
                    id: `${event.sessionId}:tool:${event.tool}:${event.timestamp}`,
                    role: 'tool',
                    content: event.output,
                    isStreaming: event.partial,
                },
            ),
        });
    }

    const transcriptEntries = [...state.transcriptEntries];
    const current = transcriptEntries[toolIndex]!;
    transcriptEntries[toolIndex] = {
        ...current,
        content: mergeToolContent(event.tool, current.content, event.output, !!event.partial),
    };
    return withDerivedChrome({
        ...state,
        runtimeStatus: 'running-tool',
        ...applyScopedNotice(state, noticeScope, event.partial ? `tool ${event.tool} streaming` : `tool ${event.tool} output`),
        transcriptEntries,
    });
}

function reduceToolCompletedViewState(
    state: TerminalAppState,
    event: { sessionId: string; timestamp: number; tool: string; success: boolean; metadata?: import('@xqoder/protocol').JsonRecord },
    noticeScope: NoticeScope,
): TerminalAppState {
    markTodaySessionStatsDirty();
    const latestToolIndex = findLatestToolEntryAny(state.transcriptEntries, event.tool);
    const latestToolEntry = latestToolIndex >= 0 ? state.transcriptEntries[latestToolIndex] : undefined;
    const finalizedEntries = state.transcriptEntries.map((entry) => {
        if (entry.role !== 'tool' || !entry.id.includes(`:${event.tool}:`) || !entry.isStreaming) {
            return entry;
        }
        return {
            ...entry,
            isStreaming: false,
            success: event.success,
        };
    });

    const patchCard = event.success && latestToolEntry
        ? buildPatchedSummaryCard(event.tool, latestToolEntry.content)
        : undefined;

    const nextEntries = patchCard
        ? appendTranscriptEntry(finalizedEntries, {
            id: `${event.sessionId}:tool:${event.tool}:patched:${event.timestamp}`,
            role: 'tool',
            content: patchCard,
            isStreaming: false,
            success: true,
        })
        : finalizedEntries;
    const verifiedEntries = patchCard
        ? appendTranscriptEntry(nextEntries, {
            id: `${event.sessionId}:tool:${event.tool}:verified:${event.timestamp}`,
            role: 'tool',
            content: patchCard,
            isStreaming: false,
            success: true,
        })
        : nextEntries;

    const rollbackPointId = (event.metadata as { rollbackPointId?: string } | undefined)?.rollbackPointId;
    const withActions = (event.success && rollbackPointId && /(apply_patch|write_file|search_replace|patch_file|edit_file)/i.test(event.tool))
        ? appendTranscriptEntry(verifiedEntries, {
            id: `${event.sessionId}:ui:rollback-actions:${rollbackPointId}:${event.timestamp}`,
            role: 'tool',
            content: `[✓ 保留]  [✗ 撤销]`,
            rollbackPointId,
            isStreaming: false,
            success: true,
        })
        : verifiedEntries;

    return withDerivedChrome({
        ...state,
        runtimeStatus: 'thinking',
        ...applyScopedNotice(state, noticeScope, patchCard ? 'patch verified' : `${event.tool} ${event.success ? 'ok' : 'failed'}`),
        transcriptEntries: withActions,
    });
}

export function reduceUiToolFeedbackToTerminalState(
    state: TerminalAppState,
    event: UiToolFeedbackEvent,
): TerminalAppState {
    switch (event.type) {
        case 'ui.tool.feedback.called':
            return reduceToolCalledViewState(state, event, 'ui');
        case 'ui.tool.feedback.output':
            return reduceToolOutputViewState(state, event, 'ui');
        case 'ui.tool.feedback.completed':
            return reduceToolCompletedViewState(state, event, 'ui');
        default:
            return withDerivedChrome(state);
    }
}

export function reduceProtocolEventToTerminalState(state: TerminalAppState, event: AppEvent): TerminalAppState {
    assertDomainToViewOneWay(event);
    switch (event.type) {
        case 'session.started':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                cwd: event.cwd,
                ...applyScopedNotice(state, 'runtime', 'session started'),
                pendingApproval: undefined,
                approvalInput: undefined,
                pendingQuestion: undefined,
                questionInput: undefined,
                runtimeStatus: 'idle',
            });
        case 'session.resumed':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                ...applyScopedNotice(state, 'runtime', `resumed ${event.messageCount} messages`),
                pendingApproval: undefined,
                approvalInput: undefined,
                pendingQuestion: undefined,
                questionInput: undefined,
                runtimeStatus: 'idle',
            });
        case 'message.started':
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                runtimeNotice: undefined,
                uiNotice: undefined,
                pendingApproval: undefined,
                approvalInput: undefined,
                pendingQuestion: undefined,
                questionInput: undefined,
                runtimeStatus: 'thinking',
                transcriptEntries: upsertTranscriptEntry(state.transcriptEntries, {
                    id: event.message.id,
                    role: event.message.role === 'tool' ? 'tool' : event.message.role,
                    content: event.message.role === 'assistant'
                        ? sanitizeAssistantText(event.message.content || '')
                        : (event.message.content || ''),
                    isStreaming: event.message.role === 'assistant',
                    attachments: attachmentsFromEvent(event),
                }),
            });
        case 'message.delta':
            return withDerivedChrome({
                ...state,
                transcriptEntries: state.transcriptEntries.map((entry) => {
                    if (entry.id !== event.messageId) {
                        return entry;
                    }
                    return {
                        ...entry,
                        content: entry.role === 'assistant'
                            ? `${entry.content}${sanitizeAssistantText(event.text)}`
                            : `${entry.content}${event.text}`,
                        isStreaming: true,
                    };
                }),
                runtimeStatus: 'thinking',
            });
        case 'message.completed':
            markTodaySessionStatsDirty();
            return withDerivedChrome({
                ...state,
                activeSessionId: event.sessionId,
                runtimeNotice: undefined,
                uiNotice: undefined,
                transcriptEntries: upsertTranscriptEntry(state.transcriptEntries, {
                    id: event.message.id,
                    role: event.message.role === 'tool' ? 'tool' : event.message.role,
                    content: event.message.role === 'assistant'
                        ? sanitizeAssistantText(event.message.content)
                        : event.message.content,
                    isStreaming: false,
                    attachments: attachmentsFromEvent(event),
                }),
                pendingApproval: undefined,
                approvalInput: undefined,
            });
        case 'tool.called':
            return reduceToolCalledViewState(state, event, 'runtime');
        case 'tool.output':
            return reduceToolOutputViewState(state, event, 'runtime');
        case 'tool.completed':
            return reduceToolCompletedViewState(state, event, 'runtime');
        case 'status.changed':
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', event.status),
                runtimeStatus: event.status,
            });
        case 'approval.requested':
            {
            const summary = normalizeApprovalSummary(event.summary);
            const payload = normalizeApprovalPayload(typeof event.payload === 'string' ? event.payload : undefined);
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', summary),
                runtimeStatus: 'awaiting-approval',
                transcriptEntries: appendTranscriptEntry(
                    appendPhaseEntry(state.transcriptEntries, event.sessionId, event.timestamp, 'Awaiting approval'),
                    {
                        id: `${event.sessionId}:tool:approval:${event.timestamp}`,
                        role: 'tool',
                        content: payload ? `approval\n${summary}\n${payload}` : `approval\n${summary}`,
                        isStreaming: false,
                        success: true,
                    },
                ),
                pendingApproval: {
                    requestId: event.requestId,
                    kind: event.kind,
                    summary,
                    payload,
                },
                approvalInput: { selectedIndex: 0 },
            });
            }
        case 'approval.resolved':
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', `approval ${event.decision}`),
                pendingApproval: undefined,
                approvalInput: undefined,
            });
        case 'question.requested': {
            const selected = event.options.length > 0 ? [event.options[0]!.label] : [];
            const normalized = normalizeQuestionText(event.header, event.question);
            const optionPreview = event.options
                .slice(0, 3)
                .map((option) => option.label)
                .join(', ');
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', normalized.notice),
                runtimeStatus: 'awaiting-approval',
                transcriptEntries: appendTranscriptEntry(
                    appendPhaseEntry(state.transcriptEntries, event.sessionId, event.timestamp, 'Awaiting approval'),
                    {
                        id: `${event.sessionId}:tool:question:${event.timestamp}`,
                        role: 'tool',
                        content: optionPreview.length > 0
                            ? `question\n${normalized.question}\nOptions: ${optionPreview}`
                            : `question\n${normalized.question}`,
                        isStreaming: false,
                        success: true,
                    },
                ),
                pendingQuestion: {
                    requestId: event.requestId,
                    ...(normalized.header ? { header: normalized.header } : {}),
                    question: normalized.question,
                    options: event.options,
                    multiple: event.multiple,
                    allowCustom: event.allowCustom,
                },
                questionInput: {
                    selectedIndex: 0,
                    selected,
                    customText: '',
                },
            });
        }
        case 'question.resolved':
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', `question resolved: ${event.selected.join(', ') || 'none'}`),
                runtimeStatus: 'thinking',
                pendingQuestion: undefined,
                questionInput: undefined,
            });
        case 'error':
            return withDerivedChrome({
                ...state,
                ...applyScopedNotice(state, 'runtime', event.message),
                runtimeStatus: 'error',
                pendingQuestion: undefined,
                questionInput: undefined,
                transcriptEntries: [...state.transcriptEntries, {
                    id: `${event.sessionId}:error:${event.timestamp}`,
                    role: 'system',
                    content: `Error: ${event.message}`,
                }],
            });
        default:
            return withDerivedChrome(state);
    }
}

export function reduceTerminalCoreEventToState(state: TerminalAppState, event: TerminalCoreEvent): TerminalAppState {
    if (event.type === 'approval.menu.move' && state.pendingApproval) {
        return withDerivedChrome({
            ...state,
            approvalInput: { selectedIndex: event.selectedIndex },
        });
    }
    return state;
}

export function reduceTerminalRuntimeResize(state: TerminalAppState, size: TerminalAppState['size']): TerminalAppState {
    return withDerivedChrome({
        ...state,
        size,
    });
}

export class ProtocolRuntimeBridge {
    constructor(private readonly dispatch: (event: TerminalCoreEvent) => void) {}

    onProtocolEvent(event: AppEvent): void {
        assertDomainToViewOneWay(event);
        this.dispatch({ type: 'runtime', event });
    }
}
