import type {
    MvpBaselineSignal,
    MvpStopEvaluationResult,
    MvpVerificationCheckResult,
    MvpVerificationResult,
} from './types.js';
import type { MvpStopConditionConfig } from './types.js';

export function createMvpOutputCheck(
    checks: MvpVerificationCheckResult[],
): MvpVerificationCheckResult {
    const failedChecks = listFailedChecks(checks);
    return {
        name: 'output',
        status: failedChecks.length === 0 ? 'passed' : 'failed',
        summary: failedChecks.length === 0
            ? 'No verifier output signalled an error.'
            : `Verifier output contains failure signals from: ${failedChecks.map((check) => check.name).join(', ')}`,
    };
}

export function createMvpBaselineCheck(
    signal: MvpBaselineSignal | undefined,
): MvpVerificationCheckResult {
    if (!signal) {
        return {
            name: 'baseline',
            status: 'skipped',
            summary: 'No recent baseline comparison was recorded.',
        };
    }

    return {
        name: 'baseline',
        status: signal.status === 'passed'
            ? 'passed'
            : signal.status === 'failed'
                ? 'failed'
                : 'skipped',
        summary: signal.summary,
    };
}

export function createMvpStopCheck(
    evaluation: MvpStopEvaluationResult,
): MvpVerificationCheckResult {
    if (evaluation.reason === 'all_met') {
        return {
            name: 'stop',
            status: 'passed',
            summary: 'Stop condition satisfied: all configured conditions are met.',
        };
    }

    return {
        name: 'stop',
        status: evaluation.shouldStop ? 'passed' : 'failed',
        summary: evaluation.failedConditions.length > 0
            ? `Stop condition blocked (${evaluation.reason}): ${evaluation.failedConditions.join(', ')}`
            : `Stop evaluator reached ${evaluation.reason} at loop ${evaluation.loopCount}.`,
    };
}

export function evaluateMvpStopConditions(input: {
    config: MvpStopConditionConfig;
    verification: MvpVerificationResult;
    loopCount: number;
    startedAt: number;
    baselineSignal?: MvpBaselineSignal;
    previousVerification?: MvpVerificationResult;
}): MvpStopEvaluationResult {
    const now = Date.now();

    if (input.config.timeoutMs !== undefined && now - input.startedAt > input.config.timeoutMs) {
        return {
            shouldStop: true,
            reason: 'timeout',
            failedConditions: [],
            loopCount: input.loopCount,
        };
    }

    if (input.loopCount >= input.config.maxLoops) {
        return {
            shouldStop: true,
            reason: 'max_loops',
            failedConditions: [],
            loopCount: input.loopCount,
        };
    }

    const hardFailed = input.config.hard.filter((condition) => {
        return !checkMvpStopCondition(condition, input.verification, input.baselineSignal, input.previousVerification);
    });
    if (hardFailed.length > 0) {
        return {
            shouldStop: false,
            reason: 'hard_failed',
            failedConditions: hardFailed,
            loopCount: input.loopCount,
        };
    }

    const softFailed = input.config.soft.filter((condition) => {
        return !checkMvpStopCondition(condition, input.verification, input.baselineSignal, input.previousVerification);
    });
    if (softFailed.length > 0) {
        return {
            shouldStop: false,
            reason: 'soft_unmet',
            failedConditions: softFailed,
            loopCount: input.loopCount,
        };
    }

    return {
        shouldStop: true,
        reason: 'all_met',
        failedConditions: [],
        loopCount: input.loopCount,
    };
}

export function isMvpStopConditionSatisfied(result: MvpVerificationResult): boolean {
    const stopCheck = result.checks.find((check) => check.name === 'stop');
    return stopCheck?.status === 'passed';
}

export function formatMvpStopEvaluationMessage(evaluation: MvpStopEvaluationResult): string {
    const failureSuffix = evaluation.failedConditions.length > 0
        ? ` (${evaluation.failedConditions.join(', ')})`
        : '';

    return `Stop evaluator: ${evaluation.reason} at loop ${evaluation.loopCount}${failureSuffix}`;
}

function checkMvpStopCondition(
    condition: string,
    verification: MvpVerificationResult,
    baselineSignal: MvpBaselineSignal | undefined,
    previousVerification: MvpVerificationResult | undefined,
): boolean {
    const getCheck = (name: MvpVerificationCheckResult['name']) => {
        return verification.checks.find((check) => check.name === name);
    };

    switch (condition) {
        case 'all_tests_pass':
            return getCheck('test')?.status === 'passed';
        case 'build_succeeds':
            return getCheck('build')?.status === 'passed';
        case 'no_lint_errors':
            return getCheck('lint')?.status === 'passed';
        case 'no_regression':
            return baselineSignal?.status !== 'failed';
        case 'lint_errors_not_worse': {
            const currentLint = getCheck('lint');
            const previousLint = previousVerification?.checks.find((check) => check.name === 'lint');
            if (!currentLint || currentLint.status === 'passed') {
                return true;
            }
            if (currentLint.issueCount === undefined || previousLint?.issueCount === undefined) {
                return true;
            }
            return currentLint.issueCount <= previousLint.issueCount;
        }
        case 'coverage_maintained': {
            const currentTest = getCheck('test');
            const previousTest = previousVerification?.checks.find((check) => check.name === 'test');
            if (currentTest?.coveragePercent === undefined || previousTest?.coveragePercent === undefined) {
                return true;
            }
            return currentTest.coveragePercent >= previousTest.coveragePercent;
        }
        default:
            return true;
    }
}

function listFailedChecks(checks: MvpVerificationCheckResult[]): MvpVerificationCheckResult[] {
    return checks.filter((check) => {
        return check.status === 'failed' && check.name !== 'output' && check.name !== 'stop';
    });
}
