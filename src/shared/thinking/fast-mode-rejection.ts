// P20b — detect fast-mode rejection errors from Anthropic and trigger the
// cooldown gate automatically.
//
// The Anthropic `speed: fast` beta responds with an APIError whose message
// mentions "fast" + "unavailable" / "rejected" / "not supported" for this
// account. Different mid-stream relays paraphrase the text, so we use a
// forgiving pattern.

import { triggerFastModeCooldown } from './fast-mode.js';

const REJECTION_PATTERN = /fast[\s_-]*mode\b.*(?:unavailable|rejected|denied|not\s+(?:supported|available|allowed)|disabled|forbidden)/i;
const SHORT_PATTERN = /\bfast\b.*\bmode\b.*(?:rate[- ]?limit|quota)/i;

export function isFastModeRejection(error: unknown): boolean {
    if (!error) return false;
    const message = error instanceof Error ? error.message : String(error);
    if (!message) return false;
    return REJECTION_PATTERN.test(message) || SHORT_PATTERN.test(message);
}

export function triggerFastModeCooldownOnRejection(error: unknown, ms?: number): boolean {
    if (!isFastModeRejection(error)) return false;
    triggerFastModeCooldown(ms);
    return true;
}
