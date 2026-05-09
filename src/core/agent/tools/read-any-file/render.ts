import type { FileAnalysisResult } from './types.js';

export function renderFileAnalysis(result: FileAnalysisResult): string {
    const lines: string[] = [
        'File Analysis',
        `path: ${result.path}`,
        `fileName: ${result.fileName}`,
        `kind: ${result.kind}`,
        `size: ${result.size} bytes`,
    ];

    if (result.mime) {
        lines.push(`mime: ${result.mime}`);
    }
    const sha256 = readMetadataString(result, 'sha256');
    if (sha256) {
        lines.push(`SHA-256: ${sha256}`);
    }
    if (result.summary) {
        lines.push('', 'Summary:', result.summary);
    }
    if (result.warnings?.length) {
        lines.push('', 'Warnings:');
        for (const warning of result.warnings) {
            lines.push(`- ${warning}`);
        }
    }
    if (result.error) {
        lines.push('', `Analyzer error: ${result.error}`);
    }
    if (result.metadata && Object.keys(result.metadata).some((key) => key !== 'sha256' && key !== 'strings' && key !== 'hexPreview')) {
        lines.push('', 'Metadata:');
        lines.push(renderMetadata(result.metadata));
    }
    if (result.documents?.length) {
        lines.push('', 'Native Documents:');
        for (const document of result.documents) {
            lines.push(`- ${document.mime} ${document.size} bytes${document.base64 ? ' (base64 in metadata.analysis.documents)' : ''}${document.path ? ` path=${document.path}` : ''}`);
        }
    }
    if (result.images?.length) {
        lines.push('', 'Rendered Images:');
        for (const image of result.images) {
            const location = image.page !== undefined ? `page ${image.page}` : image.timestamp !== undefined ? `${image.timestamp}s` : 'image';
            lines.push(`- ${location}: ${image.mime}${image.path ? ` path=${image.path}` : ''}${image.base64 ? ' (base64 in metadata.analysis.images)' : ''}`);
        }
    }
    if (result.content) {
        lines.push('', 'Content:', result.content);
    }
    if (result.transcript) {
        lines.push('', 'Transcript:', result.transcript);
    }
    if (result.children?.length) {
        lines.push('', 'Children:');
        for (const child of result.children) {
            lines.push(`- ${child.path}${child.kind ? ` (${child.kind})` : ''}${child.size !== undefined ? ` ${child.size} bytes` : ''}`);
        }
    }

    return lines.join('\n');
}

function readMetadataString(result: FileAnalysisResult, key: string): string | undefined {
    const value = result.metadata?.[key];
    return typeof value === 'string' ? value : undefined;
}

function renderMetadata(metadata: Record<string, unknown>): string {
    const compactEntries = Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== 'sha256' && key !== 'strings' && key !== 'hexPreview'),
    );
    try {
        return JSON.stringify(compactEntries, null, 2);
    } catch {
        return String(compactEntries);
    }
}
