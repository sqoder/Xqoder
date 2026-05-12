// P09 sub-PR 1: config/limit helpers extracted from conversation-engine.ts.
// Pure functions, no side effects. Caller (conversation-engine.ts) keeps its
// private copies during sub-PR 1 — sub-PR 3 rewires them to import from here.

export interface QueryLimits {
    readonly maxTurns?: number;
    readonly maxIterations?: number;
    readonly maxToolCalls?: number;
    readonly maxWallTimeMs?: number;
}

export const DEFAULT_MAX_TURNS = 20;

export function resolveMaxTurns(limits: Pick<QueryLimits, 'maxTurns' | 'maxIterations'>): number {
    return limits.maxTurns ?? limits.maxIterations ?? DEFAULT_MAX_TURNS;
}

export function isWallTimeExceeded(
    startedAt: number,
    now: number,
    maxWallTimeMs: number | undefined,
): boolean {
    return maxWallTimeMs !== undefined
        && maxWallTimeMs >= 0
        && now - startedAt > maxWallTimeMs;
}

export function wouldExceedMaxToolCalls(
    currentCount: number,
    incrementBy: number,
    maxToolCalls: number | undefined,
): boolean {
    return maxToolCalls !== undefined && currentCount + incrementBy > maxToolCalls;
}
