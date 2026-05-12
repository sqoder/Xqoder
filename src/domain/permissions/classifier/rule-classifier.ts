import { DANGEROUS_PATTERNS } from './dangerous-patterns.js';
import { SAFE_PATTERNS } from './safe-patterns.js';
import type { ClassifierResult } from './types.js';

/**
 * Synchronous rule-based shell classifier.
 *
 * Returns a definite decision when a pattern matches, `null` when the command
 * is unknown (caller should defer to LLM classifier or fall back to `ask`).
 *
 * The precedence is **dangerous → safe → unknown** so that a chained command
 * like `ls && rm -rf /` can't sneak past the safe prefix.
 */
export function classifyByRule(command: string): ClassifierResult | null {
    const cmd = command.trim();
    if (!cmd) {
        return null;
    }

    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.re.test(cmd)) {
            return { decision: 'deny', reason: pattern.reason, source: 'rule-dangerous' };
        }
    }

    for (const pattern of SAFE_PATTERNS) {
        if (pattern.re.test(cmd)) {
            if (hasRiskyContinuation(cmd)) {
                return null;
            }
            return { decision: 'allow', reason: pattern.reason, source: 'rule-safe' };
        }
    }

    return null;
}

const RISKY_CONTINUATION_RE = /(?:&&|\|\||;|\||`|\$\()/;

function hasRiskyContinuation(cmd: string): boolean {
    return RISKY_CONTINUATION_RE.test(cmd);
}
