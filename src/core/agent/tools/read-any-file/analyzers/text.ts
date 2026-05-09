import * as fs from 'node:fs/promises';
import { decode } from 'iconv-lite';
import type { AnalyzerContext, FileAnalysisResult } from '../types.js';
import { normalizeExtractedText, truncateTextByChars } from '../utils/chunk.js';
import { computeSha256 } from '../utils/hash.js';

export async function analyzeText(context: AnalyzerContext): Promise<FileAnalysisResult> {
    const readBytes = Math.min(context.stat.size, context.limits.maxTextBytes);
    const buffer = await readFileHead(context.filePath, readBytes);
    const encoding = normalizeEncoding(context.detected.encoding);
    const decoded = normalizeExtractedText(decode(buffer, encoding));
    const truncated = context.stat.size > context.limits.maxTextBytes;
    const content = truncateTextByChars(decoded, context.limits.maxTextBytes).text;
    const warnings = truncated
        ? [`Text content was truncated to ${context.limits.maxTextBytes} bytes.`]
        : undefined;

    return {
        ok: true,
        path: context.filePath,
        fileName: context.filePath.split('/').pop() ?? context.filePath,
        size: context.stat.size,
        ext: context.detected.ext,
        mime: context.detected.mime,
        kind: context.detected.kind,
        content,
        metadata: {
            encoding,
            truncated,
            sha256: await computeSha256(context.filePath),
        },
        warnings,
    };
}

async function readFileHead(filePath: string, bytes: number): Promise<Buffer> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytes);
        const result = await handle.read(buffer, 0, bytes, 0);
        return buffer.subarray(0, result.bytesRead);
    } finally {
        await handle.close();
    }
}

function normalizeEncoding(value: string | undefined): string {
    const normalized = value?.toLowerCase();
    if (!normalized || normalized === 'ascii') {
        return 'utf-8';
    }
    return normalized;
}
