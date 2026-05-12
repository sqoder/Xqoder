// P20a — Fast-mode cooldown gate.
//
// Anthropic's `speed: fast` beta can be rate-limited on a per-account basis.
// When withRetry detects a fast-mode rejection, it calls
// triggerFastModeCooldown() so subsequent turns silently fall back to
// standard speed until the cooldown expires. `/fast` toggle during the
// cooldown window is still recorded in session metadata, but does not reach
// the API.

const DEFAULT_COOLDOWN_MS = 120_000;

let fastCooldownUntil = 0;

export function triggerFastModeCooldown(ms: number = DEFAULT_COOLDOWN_MS): void {
    fastCooldownUntil = Math.max(fastCooldownUntil, Date.now() + Math.max(ms, 0));
}

export function isFastModeCoolingDown(now: number = Date.now()): boolean {
    return now < fastCooldownUntil;
}

export function getFastCooldownRemainingMs(now: number = Date.now()): number {
    return Math.max(fastCooldownUntil - now, 0);
}

/**
 * Reset the cooldown. Only used by tests; avoid calling in production code —
 * if you genuinely need to end a cooldown early, reconsider the source of the
 * rate-limit signal.
 */
export function __resetFastModeCooldownForTests(): void {
    fastCooldownUntil = 0;
}

/**
 * Toggle fast mode: 'standard' → 'fast', 'fast' → 'standard'. Returns the
 * new value. Pure function (no side effects); pair with session persistence.
 */
export function toggleFastMode(current: 'standard' | 'fast' | undefined): 'standard' | 'fast' {
    return current === 'fast' ? 'standard' : 'fast';
}
