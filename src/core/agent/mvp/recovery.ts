import type {
    MvpFailurePattern,
    MvpRecoveryDecision,
    MvpVerificationResult,
} from './types.js';

export function decideMvpRecovery(input: {
    verification: MvpVerificationResult;
    repeatedFailureCount: number;
    latestRollbackPointId?: string;
    rememberedPattern?: MvpFailurePattern | null;
}): MvpRecoveryDecision {
    const classification = input.rememberedPattern?.errorCategory ?? classifyMvpFailure(input.verification);

    if (input.rememberedPattern) {
        if (input.rememberedPattern.strategy === 'rollback' && !input.latestRollbackPointId) {
            return {
                classification,
                action: 'replan',
                summary: 'Failure memory suggested rollback, but no rollback point is available. Replan with a smaller change.',
            };
        }

        return {
            classification,
            action: input.rememberedPattern.strategy,
            summary: `[Recovery] Found known pattern (×${input.rememberedPattern.occurrences}), using: ${input.rememberedPattern.strategy}`,
            ...(input.rememberedPattern.strategy === 'rollback' && input.latestRollbackPointId
                ? { rollbackPointId: input.latestRollbackPointId }
                : {}),
            fromMemory: true,
        };
    }

    if (classification === 'timeout' && input.repeatedFailureCount === 0) {
        return {
            classification,
            action: 'retry',
            summary: 'Verifier looks transient (timeout-like). Retry the same verification once.',
        };
    }

    if (input.latestRollbackPointId && input.repeatedFailureCount >= 1) {
        return {
            classification,
            action: 'rollback',
            rollbackPointId: input.latestRollbackPointId,
            summary: `Repeated verifier failure detected. Roll back to ${input.latestRollbackPointId} and take a smaller path.`,
        };
    }

    return {
        classification,
        action: 'replan',
        summary: 'Current fix path did not verify. Replan with a smaller, targeted change based on the verifier output.',
    };
}

export function formatMvpRecoveryMessage(decision: MvpRecoveryDecision): string {
    const rollbackLine = decision.rollbackPointId
        ? `\n- Rollback point: ${decision.rollbackPointId}`
        : '';
    const memoryLine = decision.fromMemory
        ? '\n- Source: failure memory'
        : '';

    return [
        'Recovery manager:',
        `- Classification: ${decision.classification}`,
        `- Action: ${decision.action}`,
        `- Summary: ${decision.summary}`,
    ].join('\n') + rollbackLine + memoryLine;
}

export function classifyMvpFailure(verification: MvpVerificationResult): MvpRecoveryDecision['classification'] {
    const failedCheck = verification.checks.find((check) => check.status === 'failed');
    if (!failedCheck) {
        return 'unknown';
    }

    if (failedCheck.category === 'Timeout' || /timeout/i.test(failedCheck.summary)) {
        return 'timeout';
    }
    if (failedCheck.name === 'test' || failedCheck.category === 'TestFailure') {
        return 'test';
    }
    if (failedCheck.name === 'lint' || failedCheck.category === 'LintError') {
        return 'lint';
    }
    if (failedCheck.name === 'build' || failedCheck.category === 'BuildError') {
        return 'build';
    }
    if (/permission|EACCES|EPERM/i.test(failedCheck.summary)) {
        return 'permission';
    }
    if (/ENOENT|not found|missing/i.test(failedCheck.summary)) {
        return 'path';
    }
    if (/module|dependency|package/i.test(failedCheck.summary)) {
        return 'dependency';
    }

    return 'unknown';
}
