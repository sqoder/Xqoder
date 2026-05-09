// ============================================================
// File Operation Toolset
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import {
    recordToolFileReadState,
    validateExistingFileWasFullyRead,
    type ITool,
    type ToolApprovalRequest,
    type ToolContext,
    type ToolFileReadState,
} from './tool.js';
import { createFileDiffPreview, truncatePreview } from './diff.js';
import { isSandboxAccessError, resolvePathForRead, resolvePathWithinProject } from './sandbox.js';
import {
    captureMvpTestBaseline,
    compareMvpTestBaselines,
    detectMvpTestCommand,
    formatMvpBaselineSignal,
} from '../mvp/baseline.js';
import type { MvpTestBaseline } from '../mvp/types.js';
import { isDocxPath, readDocxText } from './document-readers.js';
import {
    detectFile,
    readAnyFile,
    renderFileAnalysis,
    shouldUseReadAnyForLegacyRead,
} from './read-any-file/index.js';

const MAX_FULL_READ_BYTES = 64 * 1024;
const MAX_RANGE_OUTPUT_CHARS = 100_000;
const SEARCH_CODE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const LARGE_FILE_SUGGESTED_START_LINE = 1;
const LARGE_FILE_SUGGESTED_END_LINE = 220;

class RangeOutputTooLargeError extends Error {
    constructor(chars: number) {
        super(`Requested line range is too large (${chars} chars > ${MAX_RANGE_OUTPUT_CHARS} chars). Use a narrower startLine/endLine range.`);
        this.name = 'RangeOutputTooLargeError';
    }
}

function buildLargeFileReadError(filePath: string, bytes: number): string {
    const firstRangeCall = JSON.stringify({
        path: filePath,
        startLine: LARGE_FILE_SUGGESTED_START_LINE,
        endLine: LARGE_FILE_SUGGESTED_END_LINE,
    });
    const searchHint = buildStructuralSearchHint(filePath);

    return [
        `File is too large to read fully (${bytes} bytes > ${MAX_FULL_READ_BYTES} bytes).`,
        `Use startLine/endLine first; next call should usually be read_file ${firstRangeCall}.`,
        `After that, inspect later ranges or use search_code with concrete structural tokens. ${searchHint}`,
        'Do not search generic phrases like "project overview", "project description", "project details", or "project structure"; those rarely appear in source files and can cause empty search loops.',
    ].join(' ');
}

function buildGenericSearchNoMatchOutput(filePath: string): string {
    return [
        'No matching results found',
        `Hint: this was a generic search against a single file. Use read_file with startLine/endLine on ${filePath}, starting with lines ${LARGE_FILE_SUGGESTED_START_LINE}-${LARGE_FILE_SUGGESTED_END_LINE}, or search concrete structural tokens. ${buildStructuralSearchHint(filePath)}`,
    ].join('\n');
}

function buildStructuralSearchHint(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
        return 'For HTML prototypes, use combined search_code patterns such as <body|<script|function|id=|class=|screen|tab|modal. Title/meta-only or single tag-only matches are not enough for project analysis.';
    }
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        return 'For code files, useful search_code patterns include import, export, class, function, const, interface, type, and visible UI labels.';
    }
    return 'Prefer exact headings, symbols, selectors, or visible labels from the file type.';
}

function isGenericProjectSearchPattern(pattern: string): boolean {
    const normalized = pattern.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return [
        'project overview',
        'project description',
        'project details',
        'project structure',
        'project summary',
    ].some((genericPattern) => normalized.includes(genericPattern));
}

function isOverlyBroadDirectorySearchPattern(pattern: string): boolean {
    const normalized = pattern.trim().replace(/\s+/g, '');
    return [
        '.',
        '.*',
        '.*?',
        '^.*$',
        '^.*?$',
        '[\\s\\S]*',
        '[\\d\\D]*',
        '[\\w\\W]*',
        '(?s).*',
        '(?s:.*)',
    ].includes(normalized);
}

function normalizeLineNumber(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(1, Math.floor(parsed));
}

async function readFileLineRange(
    filePath: string,
    startLine: number,
    endLine: number | undefined,
): Promise<{ content: string; lineCount: number }> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const reader = createInterface({
        input: stream,
        crlfDelay: Infinity,
    });

    try {
        return await sliceTextByLineRange(reader, startLine, endLine);
    } finally {
        reader.close();
        stream.destroy();
    }
}

async function sliceTextByLineRange(
    source: AsyncIterable<string>,
    startLine: number,
    endLine: number | undefined,
): Promise<{ content: string; lineCount: number }> {
    const lines: string[] = [];
    let currentLine = 0;
    let outputChars = 0;

    for await (const line of source) {
        currentLine += 1;
        if (currentLine < startLine) {
            continue;
        }
        if (endLine !== undefined && currentLine > endLine) {
            break;
        }

        outputChars += line.length + 1;
        if (outputChars > MAX_RANGE_OUTPUT_CHARS) {
            throw new RangeOutputTooLargeError(outputChars);
        }
        lines.push(line);
    }

    return {
        content: lines.join('\n'),
        lineCount: lines.length,
    };
}

async function readDocxLineRange(
    filePath: string,
    startLine: number,
    endLine: number | undefined,
): Promise<{ content: string; lineCount: number; extractedChars: number; sourceFormat: 'docx' }> {
    const extracted = await readDocxText(filePath);
    const ranged = await sliceTextByLineRange((async function* () {
        for (const line of extracted.content.split('\n')) {
            yield line;
        }
    })(), startLine, endLine);
    return {
        ...ranged,
        extractedChars: extracted.extractedChars,
        sourceFormat: extracted.sourceFormat,
    };
}

async function readDocxContent(
    filePath: string,
): Promise<{ content: string; extractedChars: number; sourceFormat: 'docx' }> {
    const extracted = await readDocxText(filePath);
    return extracted;
}

function buildReadMetadata(
    filePath: string,
    content: string,
    readFileState: ToolFileReadState,
    extras?: Record<string, unknown>,
): ToolResult['metadata'] {
    return {
        path: filePath,
        bytes: Buffer.byteLength(content, 'utf-8'),
        readFileState,
        ...(extras ?? {}),
    };
}

function buildDocxReadError(filePath: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `Failed to extract DOCX text from ${filePath}: ${message}`;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function buildReadState(
    filePath: string,
    stat: fs.Stats,
    toolCallId: string,
    hasRange: boolean,
    startLine: number,
    endLine: number | undefined,
): ToolFileReadState {
    return {
        path: filePath,
        fullFile: !hasRange,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        readAt: new Date().toISOString(),
        ...(toolCallId ? { toolCallId } : {}),
        ...(hasRange ? { startLine } : {}),
        ...(hasRange && endLine !== undefined ? { endLine } : {}),
    };
}

async function readFileContent(
    filePath: string,
    hasRange: boolean,
    startLine: number,
    endLine: number | undefined,
): Promise<{ content: string; metadataExtras?: Record<string, unknown> }> {
    if (isDocxPath(filePath)) {
        if (hasRange) {
            const ranged = await readDocxLineRange(filePath, startLine, endLine);
            return {
                content: ranged.content,
                metadataExtras: {
                    sourceFormat: ranged.sourceFormat,
                    extractedChars: ranged.extractedChars,
                },
            };
        }

        const extracted = await readDocxContent(filePath);
        return {
            content: extracted.content,
            metadataExtras: {
                sourceFormat: extracted.sourceFormat,
                extractedChars: extracted.extractedChars,
            },
        };
    }

    if (hasRange) {
        const ranged = await readFileLineRange(filePath, startLine, endLine);
        return {
            content: ranged.content,
        };
    }

    return {
        content: fs.readFileSync(filePath, 'utf-8'),
    };
}

async function analyzeLegacyNonTextFile(
    filePath: string,
    args: Record<string, unknown>,
    context: ToolContext,
): Promise<{ content: string; metadataExtras: Record<string, unknown> }> {
    const analysis = await readAnyFile({
        path: filePath,
        pages: typeof args['pages'] === 'string' ? args['pages'] : undefined,
        maxBytes: typeof args['maxBytes'] === 'number' ? args['maxBytes'] : undefined,
        maxPages: typeof args['maxPages'] === 'number' ? args['maxPages'] : undefined,
    }, { env: context.env });
    return {
        content: renderFileAnalysis(analysis),
        metadataExtras: { analysis },
    };
}

/** High-risk path identification. Used to escalate risk and warnings during write_file approval. */
function getWritePathRisk(filePath: string): 'high' | 'medium' {
    const normalized = path.normalize(filePath);
    const segments = normalized.split(path.sep);
    const basename = path.basename(normalized).toLowerCase();

    // Hidden directories/files (e.g., .git, .env, .env.local)
    if (segments.some((s) => s.startsWith('.'))) {
        return 'high';
    }
    if (basename.startsWith('.env') || basename === '.npmrc' || basename === '.dockerignore' || basename === '.gitignore') {
        return 'high';
    }

    // shell / scripts
    const ext = path.extname(normalized).toLowerCase();
    if (['.sh', '.bash', '.ps1'].includes(ext)) {
        return 'high';
    }

    // CI / common config paths
    if (segments.includes('.github') || segments.includes('.gitlab') || basename === '.gitlab-ci.yml') {
        return 'high';
    }
    if (['.yml', '.yaml'].includes(ext) && (basename.includes('ci') || basename.includes('config') || basename.includes('workflow'))) {
        return 'high';
    }

    return 'medium';
}

// ---- ReadFileTool ----

export class ReadFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'read_file',
        description: 'Read the content of a specified file. Can read all or part of a text file.',
        parameters: [
            { name: 'path', type: 'string', description: 'File path (relative to project root or absolute path)', required: true },
            { name: 'startLine', type: 'number', description: 'Start line number (optional, 1-based)', required: false },
            { name: 'endLine', type: 'number', description: 'End line number (optional)', required: false },
            { name: 'pages', type: 'string', description: 'Optional page range for PDFs when read_file routes to read_any_file, for example "1-5"', required: false },
            { name: 'maxBytes', type: 'number', description: 'Optional maximum bytes for non-text file analysis', required: false },
        ],
    };

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    persistLargeResult = false;

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        let filePath = '';
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            filePath = resolvePathForRead(args['path'] as string, context);
            if (!fs.existsSync(filePath)) {
                return { toolCallId, success: false, output: '', error: `File does not exist: ${filePath}` };
            }

            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Path is a directory, not a file: ${filePath}. Use list_files or search_code on this directory, then read key files such as README or package manifests.`,
                    metadata: {
                        path: filePath,
                        pathKind: 'directory',
                    },
                };
            }

            const hasRange = args['startLine'] !== undefined || args['endLine'] !== undefined;
            const startLine = normalizeLineNumber(args['startLine'], 1);
            const endLine = args['endLine'] === undefined
                ? undefined
                : normalizeLineNumber(args['endLine'], startLine);
            const detected = await detectFile(filePath);
            const shouldAnalyzeAsAnyFile = shouldUseReadAnyForLegacyRead(detected, filePath);

            if (!hasRange && stat.size > MAX_FULL_READ_BYTES && !shouldAnalyzeAsAnyFile) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: buildLargeFileReadError(filePath, stat.size),
                    metadata: {
                        path: filePath,
                        bytes: stat.size,
                        maxFullReadBytes: MAX_FULL_READ_BYTES,
                        suggestedStartLine: LARGE_FILE_SUGGESTED_START_LINE,
                        suggestedEndLine: LARGE_FILE_SUGGESTED_END_LINE,
                    },
                };
            }

            if (shouldAnalyzeAsAnyFile) {
                const { content, metadataExtras } = await analyzeLegacyNonTextFile(filePath, args, context);
                const readFileState = buildReadState(filePath, stat, toolCallId, false, 1, undefined);
                recordToolFileReadState(context, readFileState);
                return {
                    toolCallId,
                    success: true,
                    output: content,
                    metadata: buildReadMetadata(filePath, content, readFileState, metadataExtras),
                };
            }

            if (endLine !== undefined && endLine < startLine) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Invalid line range: endLine (${endLine}) must be greater than or equal to startLine (${startLine})`,
                };
            }

            const { content, metadataExtras } = await readFileContent(filePath, hasRange, startLine, endLine);

            const readFileState = buildReadState(filePath, stat, toolCallId, hasRange, startLine, endLine);
            recordToolFileReadState(context, readFileState);

            return {
                toolCallId,
                success: true,
                output: content,
                metadata: buildReadMetadata(filePath, content, readFileState, metadataExtras),
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            if (err instanceof RangeOutputTooLargeError) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: err.message,
                    metadata: {
                        maxRangeOutputChars: MAX_RANGE_OUTPUT_CHARS,
                    },
                };
            }
            const docxPath = isNonEmptyString(filePath) && isDocxPath(filePath) ? filePath : undefined;
            return {
                toolCallId,
                success: false,
                output: '',
                error: docxPath ? buildDocxReadError(docxPath, err) : `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

// ---- WriteFileTool ----

export class WriteFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'write_file',
        description: 'Write content to a specified file. Creates the file if it doesn\'t exist, and automatically creates parent directories if needed.',
        parameters: [
            { name: 'path', type: 'string', description: 'File path', required: true },
            { name: 'content', type: 'string', description: 'The content to write to the file', required: true },
        ],
    };

    isReadOnly(): boolean {
        return false;
    }

    isConcurrencySafe(): boolean {
        return false;
    }

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest {
        const inputPath = args['path'] as string;
        const nextContent = args['content'] as string;
        const filePath = resolvePathWithinProject(inputPath, context);
        const isNewFile = !fs.existsSync(filePath);

        const risk = getWritePathRisk(filePath);
        if (isNewFile) {
            return {
                toolCallId: '',
                toolName: 'write_file',
                summary: `Create new file ${filePath}`,
                reason: risk === 'high' ? 'This path is high-risk (e.g., hidden directory/environment/CI/script). Creation needs confirmation.' : 'This operation creates a new file; content must be confirmed before execution.',
                preview: createFileDiffPreview(filePath, '', nextContent),
                risk,
            };
        }

        const currentContent = fs.readFileSync(filePath, 'utf-8');
        return {
            toolCallId: '',
            toolName: 'write_file',
            summary: `Overwrite file ${filePath}`,
            reason: risk === 'high' ? 'This path is high-risk (e.g., hidden directory/environment/CI/script). Overwriting needs confirmation.' : 'This operation modifies an existing file; diff must be confirmed before execution.',
            preview: createFileDiffPreview(filePath, currentContent, nextContent),
            risk,
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        let filePath: string;
        const content = args['content'] as string;

        try {
            filePath = resolvePathWithinProject(args['path'] as string, context);
            const dir = path.dirname(filePath);
            const existedBefore = fs.existsSync(filePath);
            const readGuard = validateExistingFileWasFullyRead(filePath, context);
            if (readGuard) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: readGuard,
                    metadata: {
                        path: filePath,
                        changeType: 'write',
                        existedBefore,
                        stopReason: 'permission_denied',
                    },
                };
            }
            const rollbackPoint = context.rollbackStore?.createPoint({
                sessionId: context.sessionId,
                projectRoot: context.projectRoot,
                toolName: 'write_file',
                filePaths: [filePath],
            });
            const baselineCheckEnabled = context.mvpRuntimeConfig?.baselineCheck !== false;
            const baselineCheckRetries = Math.max(0, context.mvpRuntimeConfig?.baselineCheckRetries ?? 0);
            const baselineCommand = baselineCheckEnabled
                ? await detectMvpTestCommand(context.projectRoot)
                : null;
            let baselineBefore: MvpTestBaseline | null = null;
            let baselineNotice = baselineCheckEnabled
                ? 'Baseline check: skipped (no test command detected)'
                : 'Baseline check: skipped (disabled by config)';
            if (baselineCommand) {
                try {
                    baselineBefore = await captureMvpTestBaseline({
                        projectRoot: context.projectRoot,
                        command: baselineCommand,
                        shell: context.shell,
                    });
                    baselineNotice = `Baseline check: captured pre-write state via ${baselineCommand}`;
                } catch (error) {
                    baselineNotice = `[xqoder] Baseline check failed before write: ${error instanceof Error ? error.message : String(error)}`;
                }
            }

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, content, 'utf-8');

            if (baselineBefore && baselineCommand) {
                try {
                    const currentBaseline = await captureMvpTestBaseline({
                        projectRoot: context.projectRoot,
                        command: baselineCommand,
                        shell: context.shell,
                    });

                    if (currentBaseline) {
                        let comparison = compareMvpTestBaselines(baselineBefore, currentBaseline);
                        let retriesUsed = 0;
                        let finalBaseline = currentBaseline;

                        while (comparison.hasRegression && retriesUsed < baselineCheckRetries) {
                            retriesUsed += 1;
                            const retriedBaseline = await captureMvpTestBaseline({
                                projectRoot: context.projectRoot,
                                command: baselineCommand,
                                shell: context.shell,
                            });
                            if (!retriedBaseline) {
                                break;
                            }
                            finalBaseline = retriedBaseline;
                            comparison = compareMvpTestBaselines(baselineBefore, retriedBaseline);
                        }

                        const baselineSignal = formatMvpBaselineSignal(comparison, baselineCommand);
                        baselineNotice = comparison.hasRegression || retriesUsed === 0
                            ? baselineSignal.line
                            : `${baselineSignal.line} after retry ${retriesUsed}/${baselineCheckRetries}`;

                        if (comparison.hasRegression) {
                            if (rollbackPoint && context.rollbackStore) {
                                context.rollbackStore.restorePoint(rollbackPoint.id);
                            }

                            const regressions = comparison.regressions.join(', ');
                            const outputLines = [
                                baselineNotice,
                                `File write rolled back: ${filePath}`,
                                ...(rollbackPoint ? [`Rollback point: ${rollbackPoint.id}`] : []),
                            ];

                            return {
                                toolCallId,
                                success: false,
                                output: outputLines.join('\n'),
                                error: `Regression detected: ${regressions || 'test suite failure-count increased'}`,
                                metadata: {
                                    path: filePath,
                                    changeType: 'write',
                                    bytes: Buffer.byteLength(content, 'utf-8'),
                                    existedBefore,
                                    timestamp: new Date().toISOString(),
                                    baselineStatus: 'failed',
                                    regressions: comparison.regressions,
                                    baselineRetriesUsed: retriesUsed,
                                    baselineFailedCount: finalBaseline.failed,
                                    testCommand: baselineCommand,
                                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                                },
                            };
                        }
                    }
                } catch (error) {
                    baselineNotice = `[xqoder] Baseline check failed after write: ${error instanceof Error ? error.message : String(error)}. Proceeding without regression rollback.`;
                }
            }

            const outputLines = [
                baselineNotice,
                `File written successfully: ${filePath}`,
            ];
            if (rollbackPoint) {
                outputLines.push(`Rollback point: ${rollbackPoint.id}`);
            }
            recordFreshFullFileState(filePath, context, toolCallId);

            return {
                toolCallId,
                success: true,
                output: outputLines.join('\n'),
                metadata: {
                    path: filePath,
                    changeType: 'write',
                    bytes: Buffer.byteLength(content, 'utf-8'),
                    existedBefore,
                    timestamp: new Date().toISOString(),
                    baselineStatus: baselineNotice.includes('passed')
                        ? 'passed'
                        : baselineNotice.includes('failed')
                            ? 'failed'
                            : 'skipped',
                    ...(baselineCheckRetries > 0 ? { baselineCheckRetries } : {}),
                    ...(baselineCommand ? { testCommand: baselineCommand } : {}),
                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                },
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}

// ---- EditFileTool ----

export class EditFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'edit_file',
        description: 'Edit an existing file by replacing an exact old_string with new_string. Compatible with Claude Code style Edit operations.',
        parameters: [
            { name: 'file_path', type: 'string', description: 'Existing file path to edit', required: true },
            { name: 'old_string', type: 'string', description: 'Exact text to replace. Must be non-empty.', required: true },
            { name: 'new_string', type: 'string', description: 'Replacement text', required: true },
            { name: 'replace_all', type: 'boolean', description: 'Replace all matches instead of requiring exactly one match', required: false },
        ],
    };

    isReadOnly(): boolean {
        return false;
    }

    isConcurrencySafe(): boolean {
        return false;
    }

    buildApprovalRequest(args: Record<string, unknown>, context: ToolContext): ToolApprovalRequest | undefined {
        const resolved = resolveEditInput(args, context);
        if (!fs.existsSync(resolved.filePath)) {
            return undefined;
        }

        const currentContent = fs.readFileSync(resolved.filePath, 'utf-8');
        const previewContent = applyEditReplacement(currentContent, resolved).content;
        const risk = getWritePathRisk(resolved.filePath);
        return {
            toolCallId: '',
            toolName: 'edit_file',
            summary: `Edit file ${resolved.filePath}`,
            reason: risk === 'high'
                ? 'This edit targets a high-risk path; diff must be confirmed before execution.'
                : 'This operation edits an existing file; diff must be confirmed before execution.',
            preview: createFileDiffPreview(resolved.filePath, currentContent, previewContent),
            risk,
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const input = resolveEditInput(args, context);
            if (!input.oldString) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: 'old_string cannot be empty',
                };
            }

            if (!fs.existsSync(input.filePath)) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `File does not exist: ${input.filePath}`,
                };
            }

            const readGuard = validateExistingFileWasFullyRead(input.filePath, context);
            if (readGuard) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: readGuard,
                    metadata: {
                        path: input.filePath,
                        changeType: 'write',
                        editTool: 'edit_file',
                        existedBefore: true,
                        stopReason: 'permission_denied',
                    },
                };
            }

            const currentContent = fs.readFileSync(input.filePath, 'utf-8');
            const replacement = applyEditReplacement(currentContent, input);
            if (replacement.count === 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `old_string was not found in ${input.filePath}`,
                };
            }
            if (replacement.count > 1 && !input.replaceAll) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `old_string matched ${replacement.count} times in ${input.filePath}; pass replace_all=true to replace every match`,
                };
            }

            const rollbackPoint = context.rollbackStore?.createPoint({
                sessionId: context.sessionId,
                projectRoot: context.projectRoot,
                toolName: 'edit_file',
                filePaths: [input.filePath],
            });

            fs.writeFileSync(input.filePath, replacement.content, 'utf-8');

            const outputLines = [
                `File edited successfully: ${input.filePath}`,
                `Replacements: ${input.replaceAll ? replacement.count : 1}`,
            ];
            if (rollbackPoint) {
                outputLines.push(`Rollback point: ${rollbackPoint.id}`);
            }
            recordFreshFullFileState(input.filePath, context, toolCallId);

            return {
                toolCallId,
                success: true,
                output: outputLines.join('\n'),
                metadata: {
                    path: input.filePath,
                    changeType: 'write',
                    editTool: 'edit_file',
                    replacements: input.replaceAll ? replacement.count : 1,
                    bytes: Buffer.byteLength(replacement.content, 'utf-8'),
                    existedBefore: true,
                    timestamp: new Date().toISOString(),
                    ...(rollbackPoint ? { rollbackPointId: rollbackPoint.id } : {}),
                },
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

interface ResolvedEditInput {
    filePath: string;
    oldString: string;
    newString: string;
    replaceAll: boolean;
}

function resolveEditInput(args: Record<string, unknown>, context: ToolContext): ResolvedEditInput {
    const filePathInput = args['file_path'] ?? args['path'];
    return {
        filePath: resolvePathWithinProject(String(filePathInput ?? ''), context),
        oldString: String(args['old_string'] ?? ''),
        newString: String(args['new_string'] ?? ''),
        replaceAll: Boolean(args['replace_all']),
    };
}

function applyEditReplacement(content: string, input: ResolvedEditInput): {
    content: string;
    count: number;
} {
    if (!input.oldString) {
        return { content, count: 0 };
    }

    const count = countOccurrences(content, input.oldString);
    if (count === 0) {
        return { content, count };
    }

    if (input.replaceAll) {
        return {
            content: content.split(input.oldString).join(input.newString),
            count,
        };
    }

    return {
        content: content.replace(input.oldString, input.newString),
        count,
    };
}

function countOccurrences(content: string, needle: string): number {
    if (!needle) {
        return 0;
    }

    let count = 0;
    let index = 0;
    while (true) {
        const nextIndex = content.indexOf(needle, index);
        if (nextIndex === -1) {
            return count;
        }
        count += 1;
        index = nextIndex + needle.length;
    }
}

function recordFreshFullFileState(
    filePath: string,
    context: ToolContext,
    toolCallId: string,
): void {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const stat = fs.statSync(filePath);
    recordToolFileReadState(context, {
        path: filePath,
        fullFile: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        readAt: new Date().toISOString(),
        ...(toolCallId ? { toolCallId } : {}),
    });
}

// ---- PreviewDiffTool ----

export class PreviewDiffTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'preview_diff',
        description: 'Preview the unified diff after writing to a file, without actually modifying the file.',
        parameters: [
            { name: 'path', type: 'string', description: 'Target file path', required: true },
            { name: 'content', type: 'string', description: 'The new content expected to be written', required: true },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const filePath = resolvePathWithinProject(args['path'] as string, context);
            const nextContent = args['content'] as string;
            const currentContent = fs.existsSync(filePath)
                ? fs.readFileSync(filePath, 'utf-8')
                : '';

            return {
                toolCallId,
                success: true,
                output: createFileDiffPreview(filePath, currentContent, nextContent),
                metadata: {
                    path: filePath,
                },
            };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Failed to preview diff: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

// ---- SearchCodeTool ----

export class SearchCodeTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'search_code',
        description: 'Search for code in the project. Supports regular expressions and glob file matching.',
        parameters: [
            { name: 'pattern', type: 'string', description: 'Search pattern (string or regular expression)', required: true },
            { name: 'path', type: 'string', description: 'Search path (defaults to current project directory)', required: false },
            { name: 'include', type: 'string', description: 'File matching glob (e.g., "*.ts")', required: false },
        ],
    };

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    persistLargeResult = false;

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const pattern = args['pattern'] as string;
        const searchPath = (args['path'] as string) ?? '.';
        const include = args['include'] as string | undefined;
        const toolCallId = (args['toolCallId'] as string) ?? '';

        try {
            const resolvedSearchPath = resolvePathForRead(searchPath, context);
            const searchStat = fs.existsSync(resolvedSearchPath)
                ? fs.statSync(resolvedSearchPath)
                : undefined;
            const isSingleFileSearch = searchStat?.isFile() ?? false;
            const isDirectorySearch = searchStat?.isDirectory() ?? false;
            if (isDirectorySearch && isOverlyBroadDirectorySearchPattern(pattern)) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: 'Search pattern is too broad for a directory. Use list_files or glob_files to inspect project structure, or search concrete patterns such as README|package.json|src|app|main.',
                    metadata: {
                        path: resolvedSearchPath,
                        pathKind: 'directory',
                        broadPattern: pattern,
                    },
                };
            }
            const rgArgs = [
                '--line-number',
                '--no-heading',
                '--color',
                'never',
                '--max-count',
                '50',
            ];

            if (include) {
                rgArgs.push('--glob', include);
            }
            rgArgs.push(pattern, resolvedSearchPath);

            const result = spawnSync('rg', rgArgs, {
                cwd: context.projectRoot,
                encoding: 'utf-8',
                maxBuffer: SEARCH_CODE_MAX_BUFFER_BYTES,
                timeout: 10000,
            });

            if (result.error) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Search failed: ${result.error.message}`,
                };
            }

            if (result.status === 1) {
                const output = isSingleFileSearch && isGenericProjectSearchPattern(pattern)
                    ? buildGenericSearchNoMatchOutput(resolvedSearchPath)
                    : 'No matching results found';
                return { toolCallId, success: true, output };
            }

            if (result.status !== 0) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Search failed: ${result.stderr || `rg exit code ${result.status}`}`,
                };
            }

            return { toolCallId, success: true, output: truncatePreview(result.stdout || 'No matching results found') };
        } catch (err) {
            if (isSandboxAccessError(err)) {
                throw err;
            }
            return { toolCallId, success: false, output: '', error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}
