import type { AnalyzerContext, DetectedFile, FileAnalysisResult } from '../types.js';
import { extractPrintableStrings, formatHexPreview, readHeadBuffer, computeSha256 } from '../utils/hash.js';

export async function analyzeBinaryFallback(
    context: AnalyzerContext,
    options: {
        warnings?: string[];
        error?: unknown;
        detectedOverride?: DetectedFile;
    } = {},
): Promise<FileAnalysisResult> {
    const detected = options.detectedOverride ?? context.detected;
    const preview = await readHeadBuffer(context.filePath, 4096);
    const sha256 = await computeSha256(context.filePath);
    const strings = extractPrintableStrings(preview);
    const hexPreview = formatHexPreview(preview);
    const content = [
        'Printable strings:',
        strings.length > 0 ? strings.join('\n') : '(none found in first 4KB)',
        '',
        'Hex preview:',
        hexPreview || '(empty file)',
    ].join('\n');

    return {
        ok: true,
        path: context.filePath,
        fileName: context.filePath.split('/').pop() ?? context.filePath,
        size: context.stat.size,
        ext: detected.ext,
        mime: detected.mime ?? 'application/octet-stream',
        kind: detected.kind === 'unknown' ? 'binary' : detected.kind,
        content,
        metadata: {
            sha256,
            strings,
            hexPreview,
        },
        warnings: options.warnings,
        error: options.error instanceof Error ? options.error.message : options.error ? String(options.error) : undefined,
    };
}
