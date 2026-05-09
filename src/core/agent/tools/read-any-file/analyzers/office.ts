import * as path from 'node:path';
import { isDocxPath, readDocxText } from '../../document-readers.js';
import type { AnalyzerContext, FileAnalysisResult } from '../types.js';
import { normalizeExtractedText, truncateTextByChars } from '../utils/chunk.js';
import { commandExists, runCommand } from '../utils/command.js';
import { computeSha256 } from '../utils/hash.js';

export async function analyzeOffice(context: AnalyzerContext): Promise<FileAnalysisResult> {
    const sha256 = await computeSha256(context.filePath);
    if (isDocxPath(context.filePath)) {
        const extracted = await readDocxText(context.filePath);
        const truncated = truncateTextByChars(extracted.content, context.limits.maxTextBytes);
        return {
            ok: true,
            path: context.filePath,
            fileName: path.basename(context.filePath),
            size: context.stat.size,
            ext: context.detected.ext,
            mime: context.detected.mime,
            kind: 'document',
            content: truncated.text,
            metadata: {
                sha256,
                sourceFormat: extracted.sourceFormat,
                extractedChars: extracted.extractedChars,
                truncated: truncated.truncated,
            },
            warnings: truncated.truncated
                ? [`DOCX text was truncated to ${context.limits.maxTextBytes} characters.`]
                : undefined,
        };
    }

    if (!await commandExists('tika', context.env)) {
        return {
            ok: true,
            path: context.filePath,
            fileName: path.basename(context.filePath),
            size: context.stat.size,
            ext: context.detected.ext,
            mime: context.detected.mime,
            kind: context.detected.kind,
            metadata: { sha256 },
            warnings: ['Apache Tika is not available; install Tika to extract Office or rich-document text.'],
        };
    }

    const text = await runCommand('tika', ['--text', context.filePath], {
        env: context.env,
        timeoutMs: context.limits.commandTimeoutMs,
    });
    const metadata = await runCommand('tika', ['--metadata', context.filePath], {
        env: context.env,
        timeoutMs: context.limits.commandTimeoutMs,
    });
    const warnings: string[] = [];
    if (text.exitCode !== 0) {
        warnings.push(`tika --text failed: ${text.stderr || `exit code ${text.exitCode}`}`);
    }
    if (metadata.exitCode !== 0) {
        warnings.push(`tika --metadata failed: ${metadata.stderr || `exit code ${metadata.exitCode}`}`);
    }

    const extracted = normalizeExtractedText(text.stdout);
    const truncated = truncateTextByChars(extracted, context.limits.maxTextBytes);
    if (truncated.truncated) {
        warnings.push(`Tika text was truncated to ${context.limits.maxTextBytes} characters.`);
    }

    return {
        ok: true,
        path: context.filePath,
        fileName: path.basename(context.filePath),
        size: context.stat.size,
        ext: context.detected.ext,
        mime: context.detected.mime,
        kind: context.detected.kind,
        content: truncated.text,
        metadata: {
            sha256,
            tikaMetadata: metadata.stdout,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
