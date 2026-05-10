import type { LLMMessage } from '@xqoder/shared';
import type { ILLMProvider } from '../../../shared/llm-api/base.js';
import {
    getClassifierDenialCount,
    recordClassifierDenial,
    shouldDegradeClassifierToAsk,
} from './denial-tracking.js';
import { classifyByRule } from './rule-classifier.js';
import { classifyByLlm } from './llm-classifier.js';
import type { ClassifierResult, ShellDecision } from './types.js';

export type ClassifierProviderFactory = (tier: 1 | 2) => ILLMProvider | undefined;

export interface DecideShellPolicyInput {
    command: string;
    sessionId: string;
    transcriptTail: LLMMessage[];
    /** When false (default), the LLM layer is never consulted. */
    llmEnabled: boolean;
    /** Factory returning a provider for the requested tier. Return undefined to opt out. */
    makeProvider: ClassifierProviderFactory;
    signal?: AbortSignal;
    budgetTokens?: number;
}

/**
 * Aggregates rule classifier + optional LLM classifier + denial tracking into
 * a single decision. Always async because the LLM branch is async.
 *
 * Precedence: rule-dangerous > rule-safe > LLM (if enabled) > fallback('ask').
 * Denial tracking degrades LLM-driven `deny` to `ask` once the session has
 * hit the threshold, preventing silent classifier lock-in.
 */
export async function decideShellPolicy(
    input: DecideShellPolicyInput,
): Promise<ClassifierResult> {
    const rule = classifyByRule(input.command);
    if (rule) {
        return rule;
    }

    if (!input.llmEnabled) {
        return {
            decision: 'ask',
            reason: 'Unknown command; classifier disabled — asking user.',
            source: 'fallback',
        };
    }

    const providerStage1 = input.makeProvider(1);
    if (!providerStage1) {
        return {
            decision: 'ask',
            reason: 'Classifier provider unavailable — asking user.',
            source: 'llm-unavailable',
        };
    }

    const providerStage2 = input.makeProvider(2) ?? providerStage1;

    const llm = await classifyByLlm({
        command: input.command,
        transcriptTail: input.transcriptTail,
        providerStage1,
        providerStage2,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.budgetTokens !== undefined ? { budgetTokens: input.budgetTokens } : {}),
    });

    const degraded = applyDenialTracking(llm, input.sessionId);
    return degraded;
}

function applyDenialTracking(result: ClassifierResult, sessionId: string): ClassifierResult {
    if (result.decision !== 'deny') {
        return result;
    }

    if (!isLlmSourced(result.source)) {
        return result;
    }

    recordClassifierDenial(sessionId);

    if (shouldDegradeClassifierToAsk(sessionId)) {
        const count = getClassifierDenialCount(sessionId);
        return {
            ...result,
            decision: 'ask',
            source: 'denial-tracked',
            reason: `Classifier has denied ${count} commands this session — handing control back to user.`,
        };
    }

    return result;
}

function isLlmSourced(source: ClassifierResult['source']): boolean {
    return source === 'llm-stage1' || source === 'llm-stage2'
        || source === 'llm-unavailable' || source === 'llm-timeout';
}

export type { ShellDecision };
