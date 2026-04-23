import type { LLMMessage } from '@xqoder/shared';

export function formatDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
}

export function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

export function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

export function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

export function readIsoString(value: unknown): string | undefined {
    const asString = readString(value);
    if (!asString) {
        return undefined;
    }
    const date = new Date(asString);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function readMessages(value: unknown): LLMMessage[] | undefined {
    return Array.isArray(value) ? value as LLMMessage[] : undefined;
}
