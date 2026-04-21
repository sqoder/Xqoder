import type {
    MvpDistilledResult,
    MvpErrorCategory,
    MvpVerificationLocation,
    MvpVerifierRawOutput,
} from './types.js';

export const DEFAULT_MVP_DISTILLER_MAX_CHARS = 800;
export const DEFAULT_MVP_DISTILLER_MAX_TOKENS = 200;
const MAX_LOCATIONS = 5;

export function distillMvpVerifierOutput(
    raw: MvpVerifierRawOutput,
    maxSummaryChars: number = DEFAULT_MVP_DISTILLER_MAX_CHARS,
): MvpDistilledResult {
    const combined = `${raw.stdout}\n${raw.stderr}`.trim();
    const originalTokenCount = estimateMvpTokenCount(combined);
    const passingSummary = `${raw.verifierType} passed (${raw.durationMs}ms)`;

    if (raw.exitCode === 0) {
        return {
            passed: true,
            category: 'Unknown',
            summary: passingSummary,
            locations: [],
            rawTruncated: false,
            originalCharCount: combined.length,
            summaryTokenCount: estimateMvpTokenCount(passingSummary),
            compressionRatio: calculateCompressionRatio(originalTokenCount, estimateMvpTokenCount(passingSummary)),
            issueCount: 0,
            coveragePercent: readCoveragePercent(combined),
        };
    }

    const extracted = extractSignals(combined, raw.verifierType);
    const rawSummary = extracted.signalLines.join('\n').trim();
    const tokenBoundSummary = truncateMvpSummaryByTokens(rawSummary, DEFAULT_MVP_DISTILLER_MAX_TOKENS);
    const summary = tokenBoundSummary.length > maxSummaryChars
        ? `${tokenBoundSummary.slice(0, Math.max(0, maxSummaryChars - 8)).trimEnd()}\n…(cut)`
        : tokenBoundSummary;
    const summaryTokenCount = estimateMvpTokenCount(summary);

    return {
        passed: false,
        category: classifyMvpError(combined, raw.verifierType),
        summary,
        locations: extracted.locations.slice(0, MAX_LOCATIONS),
        rawTruncated: rawSummary.length > maxSummaryChars
            || combined.length > maxSummaryChars
            || rawSummary !== summary,
        originalCharCount: combined.length,
        summaryTokenCount,
        compressionRatio: calculateCompressionRatio(originalTokenCount, summaryTokenCount),
        issueCount: extracted.issueCount,
        coveragePercent: readCoveragePercent(combined),
    };
}

export function estimateMvpTokenCount(value: string): number {
    const normalized = value.trim();
    if (normalized.length === 0) {
        return 0;
    }

    const matches = normalized.match(/[\p{L}\p{N}_]+|[^\s]/gu);
    return matches?.length ?? 0;
}

interface SignalExtractionResult {
    signalLines: string[];
    locations: MvpVerificationLocation[];
    issueCount?: number;
}

function extractSignals(
    output: string,
    verifierType: MvpVerifierRawOutput['verifierType'],
): SignalExtractionResult {
    switch (verifierType) {
        case 'test':
            return extractTestSignals(output);
        case 'lint':
            return extractLintSignals(output);
        case 'build':
            return extractBuildSignals(output);
        case 'output':
        case 'baseline':
        default:
            return extractGenericSignals(output);
    }
}

function extractTestSignals(output: string): SignalExtractionResult {
    const lines = output.split('\n');
    const signalLines: string[] = [];
    const locations: MvpVerificationLocation[] = [];
    const keepPatterns = [
        /^\s*(?:●|✗|×|\(fail\)|FAIL)\s+/,
        /^\s*(?:Error|TypeError|ReferenceError|SyntaxError):/,
        /^\s*expect\(received\)/,
        /^\s*Expected:/,
        /^\s*Received:/,
        /^\s*[+-]\s+/,
    ];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (keepPatterns.some((pattern) => pattern.test(trimmed))) {
            signalLines.push(trimmed);
        }

        const callsiteMatch = trimmed.match(/(?:at\s+(?:.+?\s+)?\()?(.+?):(\d+):(\d+)\)?$/);
        if (callsiteMatch && !callsiteMatch[1].includes('node_modules')) {
            locations.push({
                file: callsiteMatch[1],
                line: Number.parseInt(callsiteMatch[2], 10),
                col: Number.parseInt(callsiteMatch[3], 10),
                message: signalLines.at(-1) ?? trimmed,
            });
        }
    }

    return ensureFallbackSignals(lines, signalLines, locations);
}

function extractLintSignals(output: string): SignalExtractionResult {
    const lines = output.split('\n');
    const signalLines: string[] = [];
    const locations: MvpVerificationLocation[] = [];
    const pattern = /^(.+?):(\d+):(\d+):\s+error\s+(.+)$/i;

    for (const line of lines) {
        const match = line.match(pattern);
        if (!match) {
            continue;
        }

        const file = match[1].trim();
        const lineNumber = Number.parseInt(match[2], 10);
        const col = Number.parseInt(match[3], 10);
        const message = match[4].trim();
        signalLines.push(`${file}:${lineNumber} — ${message}`);
        if (!file.includes('node_modules')) {
            locations.push({
                file,
                line: lineNumber,
                col,
                message,
            });
        }
    }

    return ensureFallbackSignals(lines, signalLines, locations, locations.length || undefined);
}

function extractBuildSignals(output: string): SignalExtractionResult {
    const lines = output.split('\n');
    const signalLines: string[] = [];
    const locations: MvpVerificationLocation[] = [];
    const tsPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(.+)$/i;
    const colonPattern = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(.+)$/i;

    for (const line of lines) {
        const match = line.match(tsPattern) ?? line.match(colonPattern);
        if (!match) {
            continue;
        }

        const file = match[1].trim();
        const lineNumber = Number.parseInt(match[2], 10);
        const col = Number.parseInt(match[3], 10);
        const message = match[4].trim();
        signalLines.push(`${file}:${lineNumber} — ${message}`);
        if (!file.includes('node_modules')) {
            locations.push({
                file,
                line: lineNumber,
                col,
                message,
            });
        }
    }

    return ensureFallbackSignals(lines, signalLines, locations, locations.length || undefined);
}

function extractGenericSignals(output: string): SignalExtractionResult {
    const lines = output.split('\n');
    const signalLines = lines
        .map((line) => line.trim())
        .filter((line) => /\b(?:ERROR|Error:|FAILED|fatal|timeout)\b/i.test(line))
        .slice(0, 10);

    return ensureFallbackSignals(lines, signalLines, []);
}

function ensureFallbackSignals(
    allLines: string[],
    signalLines: string[],
    locations: MvpVerificationLocation[],
    issueCount: number | undefined = signalLines.length || undefined,
): SignalExtractionResult {
    if (signalLines.length > 0) {
        return {
            signalLines,
            locations,
            issueCount,
        };
    }

    return {
        signalLines: allLines
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-10),
        locations,
        issueCount,
    };
}

function classifyMvpError(
    output: string,
    verifierType: MvpVerifierRawOutput['verifierType'],
): MvpErrorCategory {
    if (/timeout/i.test(output)) {
        return 'Timeout';
    }
    if (verifierType === 'test') {
        return 'TestFailure';
    }
    if (verifierType === 'lint') {
        return 'LintError';
    }
    if (verifierType === 'build') {
        return 'BuildError';
    }
    if (verifierType === 'output' || verifierType === 'baseline') {
        return 'OutputMismatch';
    }

    return 'Unknown';
}

function readCoveragePercent(output: string): number | undefined {
    const match = output.match(/All files[^%]*?(\d+(?:\.\d+)?)%/i)
        ?? output.match(/coverage[^%]*?(\d+(?:\.\d+)?)%/i);
    if (!match?.[1]) {
        return undefined;
    }

    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function truncateMvpSummaryByTokens(value: string, maxTokens: number): string {
    const normalized = value.trim();
    if (normalized.length === 0) {
        return normalized;
    }

    const matches = Array.from(normalized.matchAll(/[\p{L}\p{N}_]+|[^\s]/gu));
    if (matches.length <= maxTokens) {
        return normalized;
    }

    const lastMatch = matches[maxTokens - 1];
    if (lastMatch?.index === undefined) {
        return '…(cut)';
    }

    return `${normalized.slice(0, lastMatch.index + lastMatch[0].length).trimEnd()}\n…(cut)`;
}

function calculateCompressionRatio(originalTokenCount: number, summaryTokenCount: number): number {
    if (originalTokenCount <= 0) {
        return 1;
    }

    return Math.max(0, 1 - (summaryTokenCount / originalTokenCount));
}
