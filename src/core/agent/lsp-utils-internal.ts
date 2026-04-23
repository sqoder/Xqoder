import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export function toFilePath(uri: string): string | null {
    try {
        return path.resolve(fileURLToPath(uri));
    } catch {
        return null;
    }
}

export function extractLspRange(value: unknown): {
    start: {
        line: number;
        character: number;
    };
    end: {
        line: number;
        character: number;
    };
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const start = extractLspPosition(candidate['start']);
    const end = extractLspPosition(candidate['end']);
    if (!start || !end) {
        return null;
    }

    return {
        start,
        end,
    };
}

export function extractMarkedText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.trim() || null;
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractMarkedText(entry))
            .filter((entry): entry is string => Boolean(entry));
        return parts.length > 0 ? parts.join('\n\n') : null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate['value'] === 'string') {
        const prefix = typeof candidate['language'] === 'string'
            ? `\`\`\`${candidate['language']}\n${candidate['value']}\n\`\`\``
            : candidate['value'];
        return prefix.trim() || null;
    }

    return null;
}

function extractLspPosition(value: unknown): {
    line: number;
    character: number;
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const line = Number(candidate['line']);
    const character = Number(candidate['character']);
    if (!Number.isFinite(line) || !Number.isFinite(character)) {
        return null;
    }

    return {
        line,
        character,
    };
}
