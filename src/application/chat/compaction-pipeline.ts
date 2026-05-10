// P02 compaction wiring extracted from conversation-engine.ts.
// Owns: maybeAutoCompact (threshold summarizer), applyProgressiveCompaction
// (per-turn budget→snip→micro), and runTurnWithReactiveCompaction
// (PromptTooLongError recovery loop).

import type { Logger } from '@xqoder/shared';
import { getContextWindow } from '@xqoder/shared';
import { feature } from '../../shared/feature-flags.js';
import type { AgentCallbacks, AgentEvents, AgentRuntimeProfile, AgentSession } from '@xqoder/agent';
import {
    PromptTooLongError,
    applyToolResultBudget,
    snipCompactIfNeeded,
    microcompact,
    nextReactiveStep,
    applyReactiveStep,
    type ReactiveStep,
} from '@xqoder/agent';
import type { LLMProviderConfig, CompactionConfig } from '@xqoder/shared';
import type { ProviderTurnResult } from './provider-turn.js';
import { estimateTokenBudget } from './token-budget.js';

type CompactionEventEmitter = <K extends keyof AgentEvents>(
    type: K,
    data: AgentEvents[K],
    streamId?: string,
) => void;

interface CompactionPipelineDeps {
    session: AgentSession;
    logger: Logger;
    llmConfig: LLMProviderConfig;
    runtimeProfile: AgentRuntimeProfile;
    compaction?: CompactionConfig;
    callbacks?: AgentCallbacks;
    streamId: string;
    emit: CompactionEventEmitter;
}

export async function maybeAutoCompact(
    usage: ProviderTurnResult['usage'],
    dependencies: CompactionPipelineDeps,
): Promise<void> {
    if (process.env.XQODER_DISABLE_ADVANCED_COMPACT !== '1') {
        applyProgressiveCompaction(dependencies);
    }

    const ctxWindow = getContextWindow(dependencies.llmConfig.model);
    if (
        dependencies.runtimeProfile === 'mvp'
        || dependencies.compaction?.auto === false
        || !ctxWindow
        || usage.promptTokens < ctxWindow * 0.85
    ) {
        return;
    }

    dependencies.logger.warn(
        `Context usage at ${Math.round(usage.promptTokens / ctxWindow * 100)}%, triggering auto-compact`,
    );
    try {
        const messages = dependencies.session.getMessages().filter((m) => m.role !== 'system');
        const { SummarizerAgent } = await import('@xqoder/agent');
        const summaryAgent = new SummarizerAgent(dependencies.llmConfig);
        const summary = await summaryAgent.summarize(messages);
        dependencies.session.performCompaction(summary);
        dependencies.emit(
            'message',
            { role: 'system', content: `[Auto-compacted context summary]: ${summary}` },
            dependencies.streamId,
        );
        try { dependencies.callbacks?.onToolEnd?.('auto_compact', summary, true); } catch { /* noop */ }
    } catch (err) {
        dependencies.logger.error(
            `Auto-compact failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

// Run the cheap byte-based compaction pipeline every turn:
//   ① applyToolResultBudget → ② snipCompactIfNeeded → ③ microcompact
// Pure transforms installed via replaceMessages only when something changed.
function applyProgressiveCompaction(dependencies: CompactionPipelineDeps): void {
    const current = dependencies.session.getMessages();

    const budgeted = applyToolResultBudget(current);
    for (const t of budgeted.truncated) {
        dependencies.logger.debug(
            `tool-result truncated: ${t.toolCallId} ${t.originalBytes}→${t.keptBytes}`,
        );
    }

    const snipped = snipCompactIfNeeded(budgeted.messages);
    if (snipped.snipped) {
        dependencies.logger.debug('snipCompactIfNeeded: middle scroll buffer snipped');
    }

    const afterMicro = microcompact(snipped.messages);

    if (
        budgeted.truncated.length > 0
        || snipped.snipped
        || afterMicro !== snipped.messages
    ) {
        dependencies.session.replaceMessages(afterMicro);
    }
}

// Wrap a provider-turn thunk with reactive compaction so that
// `PromptTooLongError` triggers snip → micro → auto recovery and a retry of
// the same turn. At most 3 attempts before rethrowing.
export async function runTurnWithReactiveCompaction<T>(
    runTurn: () => Promise<T>,
    session: AgentSession,
    logger: Logger,
): Promise<T> {
    let step: ReactiveStep | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await runTurn();
        } catch (err) {
            lastError = err;
            if (!(err instanceof PromptTooLongError)) throw err;
            const nextStep = nextReactiveStep(step);
            if (nextStep === 'exhausted') throw err;
            logger.warn(
                `PromptTooLongError at attempt ${attempt + 1}; applying reactive compaction step: ${nextStep}`,
            );
            applyReactiveStep(session, nextStep);
            step = nextStep;
        }
    }
    throw lastError ?? new Error('reactive compaction exhausted');
}

// P10: active token-budget trigger (ADR 0005 §3 carry-over).
// Runs before the provider turn when `TOKEN_BUDGET_ACTIVE` is enabled. Uses
// the approximate budget estimator to decide whether to proactively walk the
// snip → micro → autocompact ladder, instead of waiting for reactive
// PromptTooLongError recovery. Default-off behavior is preserved by the
// feature flag; no callers need to change.
export async function maybeActiveTokenBudgetCompact(
    dependencies: CompactionPipelineDeps,
): Promise<void> {
    if (!feature('TOKEN_BUDGET_ACTIVE')) {
        return;
    }
    if (dependencies.runtimeProfile === 'mvp') {
        return;
    }
    if (process.env.XQODER_DISABLE_ADVANCED_COMPACT === '1') {
        return;
    }

    const messages = dependencies.session.getMessages();
    const budget = estimateTokenBudget(messages, dependencies.llmConfig.model);
    if (budget.reason === 'ok' || budget.contextWindow === undefined) {
        return;
    }

    dependencies.logger.warn(
        `token budget ${budget.reason} (used≈${budget.used}/${budget.contextWindow}); pre-emptive compaction`,
    );

    // Step 1: byte-based pipeline (snip + micro + budget) is always safe.
    applyProgressiveCompaction(dependencies);

    if (budget.reason !== 'exhausted') {
        return;
    }

    // Step 2: if still exhausted after snip/micro, trigger the summarizer path.
    // `maybeAutoCompact` expects a usage object — synthesize one so it runs the
    // summarizer branch. This reuses the existing emit / callback plumbing.
    const postSnip = estimateTokenBudget(
        dependencies.session.getMessages(),
        dependencies.llmConfig.model,
    );
    if (postSnip.reason !== 'exhausted' || postSnip.contextWindow === undefined) {
        return;
    }
    const ctxWindow = postSnip.contextWindow;
    await maybeAutoCompact(
        {
            promptTokens: Math.max(postSnip.used, Math.ceil(ctxWindow * 0.9)),
            completionTokens: 0,
            totalTokens: postSnip.used,
        } satisfies ProviderTurnResult['usage'],
        dependencies,
    );
}
