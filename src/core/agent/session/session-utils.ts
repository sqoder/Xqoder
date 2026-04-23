import type { AgentFileChangeEntry } from './session-types.js';

export const AUTO_SUMMARY_PREFIX = '[XQoder auto-compact summary]';
export const MAX_TEXT_PREVIEW_LENGTH = 400;
export const MAX_ARG_PREVIEW_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 1600;

export function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateCompactionId(): string {
    return `compact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTextPreview(value: string): string {
    return truncateText(value.trim(), MAX_TEXT_PREVIEW_LENGTH);
}

export function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : new Date(value);
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const normalized = new Date(value);
        return Number.isNaN(normalized.getTime()) ? undefined : normalized;
    }

    return undefined;
}

export function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isFileChangeType(value: string | undefined): value is AgentFileChangeEntry['changeType'] {
    return value === 'write' || value === 'patch' || value === 'restore';
}
