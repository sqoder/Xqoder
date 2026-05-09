import type { AnalysisLimits, ReadAnyFileInput } from '../types.js';

export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimits = {
    maxBytes: 50 * 1024 * 1024,
    maxTextBytes: 2 * 1024 * 1024,
    maxPdfPages: 20,
    maxFrames: 40,
    maxArchiveFiles: 200,
    maxArchiveDepth: 2,
    commandTimeoutMs: 30_000,
};

export function resolveAnalysisLimits(input: ReadAnyFileInput): AnalysisLimits {
    return {
        ...DEFAULT_ANALYSIS_LIMITS,
        maxBytes: resolvePositiveInteger(input.maxBytes, DEFAULT_ANALYSIS_LIMITS.maxBytes),
        maxPdfPages: resolvePositiveInteger(input.maxPages, DEFAULT_ANALYSIS_LIMITS.maxPdfPages),
        maxFrames: resolvePositiveInteger(input.maxFrames, DEFAULT_ANALYSIS_LIMITS.maxFrames),
        maxArchiveDepth: resolvePositiveInteger(input.maxDepth, DEFAULT_ANALYSIS_LIMITS.maxArchiveDepth),
    };
}

function resolvePositiveInteger(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }

    return Math.floor(value);
}
