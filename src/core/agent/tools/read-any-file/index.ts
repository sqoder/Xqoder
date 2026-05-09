import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MessageAttachment, ToolDefinition, ToolResult } from '@xqoder/shared';
import { detectFile } from './detect.js';
import { renderFileAnalysis } from './render.js';
import { routeFileAnalysis } from './route.js';
import type {
    FileAnalysisResult,
    ReadAnyFileInput,
    ReadAnyFileRuntimeContext,
} from './types.js';
import { resolveAnalysisLimits } from './utils/limits.js';
import {
    recordToolFileReadState,
    type ITool,
    type ToolContext,
    type ToolFileReadState,
} from '../tool.js';
import { isSandboxAccessError, resolvePathForRead } from '../sandbox.js';

export type {
    AnalysisLimits,
    DetectedFile,
    FileAnalysisResult,
    FileKind,
    ReadAnyFileInput,
    ReadAnyFileMode,
} from './types.js';
export { detectFile, shouldUseReadAnyForLegacyRead } from './detect.js';
export { renderFileAnalysis } from './render.js';

export async function readAnyFile(
    input: ReadAnyFileInput,
    runtimeContext: ReadAnyFileRuntimeContext = {},
): Promise<FileAnalysisResult> {
    const filePath = path.resolve(input.path);
    const stat = fs.statSync(filePath);
    const detected = await detectFile(filePath);
    const limits = resolveAnalysisLimits(input);
    return routeFileAnalysis({
        input,
        filePath,
        stat,
        detected,
        limits,
        env: runtimeContext.env,
    });
}

export class ReadAnyFileTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'read_any_file',
        description: 'Analyze a file by detecting its type and extracting text, metadata, native PDF payloads, rendered PDF pages, OCR, or a safe binary preview.',
        parameters: [
            { name: 'path', type: 'string', description: 'File path (relative to current working directory or absolute path)', required: true },
            { name: 'pages', type: 'string', description: 'Optional page range for PDFs, for example "1-5"', required: false },
            { name: 'mode', type: 'string', description: 'Optional mode: auto, text, metadata, raw, render, or ocr', required: false },
            { name: 'maxBytes', type: 'number', description: 'Maximum file size to deeply analyze before falling back to metadata/binary preview', required: false },
            { name: 'maxPages', type: 'number', description: 'Maximum PDF pages to process when pages is provided', required: false },
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
        const toolCallId = (args['toolCallId'] as string) ?? '';
        try {
            const filePath = resolvePathForRead(args['path'] as string, context);
            if (!fs.existsSync(filePath)) {
                return { toolCallId, success: false, output: '', error: `File does not exist: ${filePath}` };
            }

            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Path is a directory, not a file: ${filePath}. Use list_files or search_code on this directory first.`,
                    metadata: { path: filePath, pathKind: 'directory' },
                };
            }

            const analysis = await readAnyFile(resolveReadAnyArgs(args, filePath), { env: context.env });
            const output = renderFileAnalysis(analysis);
            recordToolFileReadState(context, buildReadState(filePath, stat, toolCallId));

            return {
                toolCallId,
                success: true,
                output,
                attachments: buildAnalysisAttachments(analysis),
                metadata: {
                    path: filePath,
                    bytes: stat.size,
                    analysis,
                },
            };
        } catch (error) {
            if (isSandboxAccessError(error)) {
                throw error;
            }
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Failed to analyze file: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
}

function buildAnalysisAttachments(analysis: FileAnalysisResult): MessageAttachment[] | undefined {
    const attachments: MessageAttachment[] = [];
    for (const document of analysis.documents ?? []) {
        if (!document.base64) {
            continue;
        }
        attachments.push({
            type: 'file',
            mimeType: document.mime,
            data: document.base64,
            fileName: document.path ? path.basename(document.path) : analysis.fileName,
            ...(document.path ? { filePath: document.path } : {}),
        });
    }
    for (const image of analysis.images ?? []) {
        if (!image.base64) {
            continue;
        }
        attachments.push({
            type: 'image',
            mimeType: image.mime,
            data: image.base64,
            fileName: image.path
                ? path.basename(image.path)
                : buildImageAttachmentName(analysis.fileName, image.page),
            ...(image.path ? { filePath: image.path } : {}),
        });
    }
    return attachments.length > 0 ? attachments : undefined;
}

function buildImageAttachmentName(fileName: string, page: number | undefined): string {
    const suffix = page !== undefined ? `page-${page}` : 'image';
    return `${fileName}-${suffix}.jpg`;
}

function resolveReadAnyArgs(args: Record<string, unknown>, filePath: string): ReadAnyFileInput {
    return {
        path: filePath,
        pages: typeof args['pages'] === 'string' ? args['pages'] : undefined,
        mode: typeof args['mode'] === 'string' ? args['mode'] as ReadAnyFileInput['mode'] : undefined,
        maxBytes: typeof args['maxBytes'] === 'number' ? args['maxBytes'] : undefined,
        maxPages: typeof args['maxPages'] === 'number' ? args['maxPages'] : undefined,
    };
}

function buildReadState(filePath: string, stat: fs.Stats, toolCallId: string): ToolFileReadState {
    return {
        path: filePath,
        fullFile: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        readAt: new Date().toISOString(),
        ...(toolCallId ? { toolCallId } : {}),
    };
}
