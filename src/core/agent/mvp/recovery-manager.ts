import type { RollbackStore } from '../tools/rollback-store.js';
import type {
    MvpFailurePattern,
    MvpRecoveryDecision,
    MvpVerificationResult,
} from './types.js';
import { decideMvpRecovery, formatMvpRecoveryMessage } from './recovery.js';

export interface MvpRecoveryManagerInput {
    verification: MvpVerificationResult;
    repeatedFailureCount: number;
    latestRollbackPointId?: string;
    rememberedPattern?: MvpFailurePattern | null;
}

export function resolveMvpRecoveryDecision(
    input: MvpRecoveryManagerInput,
): MvpRecoveryDecision {
    return decideMvpRecovery({
        verification: input.verification,
        repeatedFailureCount: input.repeatedFailureCount,
        latestRollbackPointId: input.latestRollbackPointId,
        rememberedPattern: input.rememberedPattern,
    });
}

export function applyMvpRecoveryDecision(
    decision: MvpRecoveryDecision,
    rollbackStore: RollbackStore | undefined,
): MvpRecoveryDecision {
    if (decision.action !== 'rollback' || !decision.rollbackPointId || !rollbackStore) {
        return decision;
    }

    try {
        rollbackStore.restorePoint(decision.rollbackPointId);
        return decision;
    } catch (error) {
        return {
            classification: decision.classification,
            action: 'replan',
            summary: `Rollback failed (${error instanceof Error ? error.message : String(error)}). Replan with a smaller change.`,
        };
    }
}

export function renderMvpRecoveryMessage(decision: MvpRecoveryDecision): string {
    return formatMvpRecoveryMessage(decision);
}
