import type { PreToolPermissionDecision } from './hooks.js';

export interface HookHandlerResponse {
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    decision?: string;
    reason?: string;
    hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
        additionalContext?: string;
    };
}

export function parseHookHandlerOutput(output: string | undefined): HookHandlerResponse | null {
    if (!output?.trim()) {
        return null;
    }

    const parsedText = extractJsonObject(output);
    if (!parsedText) {
        return null;
    }

    try {
        const parsed = JSON.parse(parsedText) as HookHandlerResponse;
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
        return null;
    }
}

export function mergePermissionDecision(
    current: PreToolPermissionDecision | undefined,
    next: PreToolPermissionDecision,
): PreToolPermissionDecision {
    if (!current) {
        return next;
    }
    const rank: Record<PreToolPermissionDecision, number> = {
        allow: 1,
        ask: 2,
        deny: 3,
    };
    return rank[next] > rank[current] ? next : current;
}

export function normalizePermissionDecision(value: string | undefined): PreToolPermissionDecision | undefined {
    if (value === 'allow' || value === 'ask' || value === 'deny') {
        return value;
    }
    return undefined;
}

function extractJsonObject(output: string): string | null {
    const trimmed = output.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
        return null;
    }
    return trimmed.slice(start, end + 1);
}
