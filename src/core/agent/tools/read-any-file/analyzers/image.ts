import * as path from 'node:path';
import type { AnalyzerContext, FileAnalysisResult } from '../types.js';
import { normalizeExtractedText, truncateTextByChars } from '../utils/chunk.js';
import { commandExists, runCommand } from '../utils/command.js';
import { computeSha256 } from '../utils/hash.js';

export async function analyzeImage(context: AnalyzerContext): Promise<FileAnalysisResult> {
    const warnings: string[] = [];
    const sha256 = await computeSha256(context.filePath);
    let exif: unknown;
    let content: string | undefined;

    if (await commandExists('exiftool', context.env)) {
        const result = await runCommand('exiftool', ['-json', context.filePath], {
            env: context.env,
            timeoutMs: context.limits.commandTimeoutMs,
        });
        if (result.exitCode === 0) {
            exif = parseExifJson(result.stdout);
        } else {
            warnings.push(`exiftool failed: ${result.stderr || `exit code ${result.exitCode}`}`);
        }
    } else {
        warnings.push('exiftool is not available; image EXIF metadata was not extracted.');
    }

    if (await commandExists('tesseract', context.env)) {
        const result = await runCommand('tesseract', [context.filePath, 'stdout', '-l', 'chi_sim+eng'], {
            env: context.env,
            timeoutMs: context.limits.commandTimeoutMs,
        });
        if (result.exitCode === 0) {
            const ocr = normalizeExtractedText(result.stdout);
            const truncated = truncateTextByChars(ocr, context.limits.maxTextBytes);
            content = truncated.text;
            if (truncated.truncated) {
                warnings.push(`OCR text was truncated to ${context.limits.maxTextBytes} characters.`);
            }
        } else {
            warnings.push(`tesseract failed: ${result.stderr || `exit code ${result.exitCode}`}`);
        }
    } else {
        warnings.push('tesseract is not available; OCR text was not extracted.');
    }

    return {
        ok: true,
        path: context.filePath,
        fileName: path.basename(context.filePath),
        size: context.stat.size,
        ext: context.detected.ext,
        mime: context.detected.mime,
        kind: 'image',
        content,
        metadata: {
            sha256,
            ...(exif ? { exif } : {}),
        },
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

function parseExifJson(value: string): unknown {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
        return value;
    }
}
