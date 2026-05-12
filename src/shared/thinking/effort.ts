// P20a — Effort level parsing and normalization.
//
// CLI + slash commands accept free-form effort strings ("high", "medium",
// "xhigh", "extra-high"); this module normalizes them into the canonical
// EffortLevel union.

import type { EffortLevel } from './thinking-config.js';

export { mapEffortToBudgetTokens } from './thinking-config.js';
export type { EffortLevel };

const EFFORT_ALIASES: Record<string, EffortLevel> = {
    low: 'low',
    'min': 'low',
    minimal: 'low',
    medium: 'medium',
    mid: 'medium',
    'default': 'medium',
    high: 'high',
    'max': 'high',
    xhigh: 'xhigh',
    'extra-high': 'xhigh',
    'extra_high': 'xhigh',
    extreme: 'xhigh',
};

export function parseEffort(raw: string | undefined): EffortLevel | undefined {
    if (!raw) return undefined;
    const key = raw.trim().toLowerCase();
    return EFFORT_ALIASES[key];
}

export function assertEffort(raw: string | undefined): EffortLevel {
    const parsed = parseEffort(raw);
    if (!parsed) {
        throw new Error(`invalid effort level: ${raw ?? '(empty)'} — expected one of low|medium|high|xhigh`);
    }
    return parsed;
}

export function formatEffort(effort: EffortLevel | undefined): string {
    return effort ?? 'unset';
}
