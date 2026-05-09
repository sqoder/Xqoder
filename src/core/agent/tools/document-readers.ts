import * as path from 'node:path';
import mammoth from 'mammoth';

export interface ExtractedDocumentText {
    content: string;
    sourceFormat: 'docx';
    extractedChars: number;
}

export function isDocxPath(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.docx';
}

export async function readDocxText(filePath: string): Promise<ExtractedDocumentText> {
    const result = await mammoth.extractRawText({ path: filePath });
    const content = normalizeExtractedText(result.value);

    if (!content) {
        throw new Error('DOCX did not contain any extractable text');
    }

    return {
        content,
        sourceFormat: 'docx',
        extractedChars: content.length,
    };
}

function normalizeExtractedText(content: string): string {
    return content
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}
