// P02 module 4: Reactive compaction controller.
// Drives cascading snip → micro → auto recovery when the provider raises
// PromptTooLongError. Does NOT invoke any model — all compaction is local.

import type { LLMMessage } from '@xqoder/shared';
import { snipCompactIfNeeded } from './snip.js';
import { microcompact } from './microcompact.js';

export type ReactiveStep = 'snip' | 'micro' | 'auto' | 'exhausted';

export function nextReactiveStep(prev: ReactiveStep | undefined): ReactiveStep {
    switch (prev) {
        case undefined:
            return 'snip';
        case 'snip':
            return 'micro';
        case 'micro':
            return 'auto';
        case 'auto':
        case 'exhausted':
        default:
            return 'exhausted';
    }
}

export interface ReactiveSessionTarget {
    getMessages(): LLMMessage[];
    replaceMessages(messages: LLMMessage[]): void;
    performCompaction(summary: string): void;
}

/**
 * Applies one reactive step to the given session target. Idempotent by design:
 * snip/micro are pure transforms; auto delegates to the session's own
 * performCompaction. Caller is expected to retry the provider turn afterwards.
 */
export function applyReactiveStep(
    session: ReactiveSessionTarget,
    step: ReactiveStep,
): void {
    if (step === 'exhausted') return;

    if (step === 'snip') {
        const current = session.getMessages();
        const { messages, snipped } = snipCompactIfNeeded(current);
        if (snipped) session.replaceMessages(messages);
        return;
    }

    if (step === 'micro') {
        const current = session.getMessages();
        const next = microcompact(current);
        if (next !== current) session.replaceMessages(next);
        return;
    }

    // step === 'auto'
    session.performCompaction(
        '[reactive] prompt-too-long recovery: prior context auto-folded.',
    );
}
