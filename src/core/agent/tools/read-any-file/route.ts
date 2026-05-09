import * as path from 'node:path';
import type { AnalyzerContext, FileAnalysisResult } from './types.js';
import { analyzeBinaryFallback } from './analyzers/binary.js';
import { analyzeImage } from './analyzers/image.js';
import { analyzeOffice } from './analyzers/office.js';
import { analyzePdf } from './analyzers/pdf.js';
import { analyzeText } from './analyzers/text.js';
import { computeSha256 } from './utils/hash.js';

export async function routeFileAnalysis(context: AnalyzerContext): Promise<FileAnalysisResult> {
    if (context.input.mode === 'metadata') {
        return analyzeMetadataOnly(context);
    }

    if (context.stat.size > context.limits.maxBytes) {
        return analyzeBinaryFallback(context, {
            warnings: [`File exceeds maxBytes (${context.stat.size} bytes > ${context.limits.maxBytes} bytes); returned metadata and binary preview only.`],
        });
    }

    try {
        switch (context.detected.kind) {
            case 'text':
            case 'code':
                return await analyzeText(context);
            case 'pdf':
                return await analyzePdf(context);
            case 'document':
            case 'spreadsheet':
            case 'presentation':
                return await analyzeOffice(context);
            case 'image':
                return await analyzeImage(context);
            default:
                return await analyzeBinaryFallback(context);
        }
    } catch (error) {
        return analyzeBinaryFallback(context, {
            warnings: ['Primary analyzer failed; fell back to binary analysis.'],
            error,
        });
    }
}

async function analyzeMetadataOnly(context: AnalyzerContext): Promise<FileAnalysisResult> {
    return {
        ok: true,
        path: context.filePath,
        fileName: path.basename(context.filePath),
        size: context.stat.size,
        ext: context.detected.ext,
        mime: context.detected.mime,
        kind: context.detected.kind,
        metadata: {
            sha256: await computeSha256(context.filePath),
        },
        warnings: ['metadata mode requested; content extraction was skipped.'],
    };
}
