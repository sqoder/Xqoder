import type {
    CompletionMatch as LspCompletionMatch,
    HoverMatch as LspHoverMatch,
    DiagnosticMatch as LspDiagnosticMatch,
    LocationMatch as LspLocationMatch,
    WorkspaceSymbolMatch as LspSymbolMatch,
} from '../lsp.js';

export function formatSymbolMatch(match: LspSymbolMatch): string {
    return [
        `- ${match.kind} ${match.name}`,
        `${match.filePath}:${match.line}:${match.character}`,
        match.containerName ? `container=${match.containerName}` : undefined,
        match.preview,
    ].filter((part): part is string => Boolean(part)).join('  ');
}

export function formatDiagnosticMatch(match: LspDiagnosticMatch): string {
    return `- ${match.severity} ${match.code} ${match.filePath}:${match.line}:${match.character} ${match.message}`;
}

export function formatLocationMatch(match: LspLocationMatch): string {
    const kindPrefix = match.kind ? `${match.kind} ` : '';
    return `- ${kindPrefix}${match.filePath}:${match.line}:${match.character}  ${match.preview}`;
}

export function formatHoverMatch(match: LspHoverMatch): string {
    const range = match.range
        ? `range=${match.range.line}:${match.range.character}-${match.range.endLine}:${match.range.endCharacter}`
        : undefined;

    return [
        range,
        match.contents,
    ].filter((entry): entry is string => Boolean(entry)).join('\n');
}

export function formatCompletionMatch(match: LspCompletionMatch): string {
    return [
        `- ${match.label}${match.kind ? ` [${match.kind}]` : ''}${match.resolved ? ' [resolved]' : ''}`,
        match.detail,
        match.insertText && match.insertText !== match.label ? `insert=${match.insertText}` : undefined,
        match.documentation,
    ].filter((entry): entry is string => Boolean(entry)).join('  ');
}
