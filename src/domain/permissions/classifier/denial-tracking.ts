/**
 * Per-session denial tracker for the yolo shell classifier.
 *
 * OpenClaude's behavior: once the LLM classifier has denied N times in a
 * session, degrade future verdicts to `ask` so the user gets explicit control.
 * This prevents the classifier from silently ban-hammering a long session
 * without the user ever seeing the prompts.
 *
 * This module is intentionally a plain mutable map keyed by sessionId so
 * callers don't have to thread session state into every classifier call.
 */
const DEFAULT_DEGRADE_THRESHOLD = 3;

const denialCounts = new Map<string, number>();
let degradeThreshold = DEFAULT_DEGRADE_THRESHOLD;

export function recordClassifierDenial(sessionId: string): number {
    const next = (denialCounts.get(sessionId) ?? 0) + 1;
    denialCounts.set(sessionId, next);
    return next;
}

export function getClassifierDenialCount(sessionId: string): number {
    return denialCounts.get(sessionId) ?? 0;
}

export function shouldDegradeClassifierToAsk(sessionId: string): boolean {
    return getClassifierDenialCount(sessionId) >= degradeThreshold;
}

export function resetClassifierDenials(sessionId?: string): void {
    if (sessionId === undefined) {
        denialCounts.clear();
        return;
    }
    denialCounts.delete(sessionId);
}

export function setClassifierDegradeThresholdForTests(value: number): void {
    degradeThreshold = value;
}

export function resetClassifierDegradeThresholdForTests(): void {
    degradeThreshold = DEFAULT_DEGRADE_THRESHOLD;
}
