export type AgentRuntimeProfile = 'full' | 'mvp' | 'hybrid';

export type MvpTaskType = 'bugfix' | 'feature' | 'refactor' | 'question';

export type MvpPlannerAction = 'search_code' | 'read_file' | 'write_file' | 'run_shell' | 'answer';

export type MvpContextTier = 'Goal' | 'Error' | 'Active' | 'History' | 'Background';

export type MvpVerificationCheckName = 'baseline' | 'test' | 'lint' | 'build' | 'output' | 'stop';

export type MvpVerifierType = 'baseline' | 'test' | 'lint' | 'build' | 'output';

export type MvpBaselineStatus = 'passed' | 'failed' | 'skipped';

export type MvpErrorCategory =
    | 'TestFailure'
    | 'LintError'
    | 'BuildError'
    | 'OutputMismatch'
    | 'Timeout'
    | 'Unknown';

export type MvpHardStopCondition =
    | 'all_tests_pass'
    | 'build_succeeds'
    | 'no_lint_errors'
    | 'no_regression';

export type MvpSoftStopCondition =
    | 'lint_errors_not_worse'
    | 'coverage_maintained';

export interface MvpProjectRule {
    path: string;
    content: string;
}

export interface MvpCollectedContext {
    userGoal: string;
    taskType: MvpTaskType;
    targetPaths: string[];
    relatedPaths: string[];
    projectRules: MvpProjectRule[];
    gitStatus: string[];
    gitDiffSnippets: string[];
    recentFileChanges: string[];
    recentCommands: string[];
    recentToolSignals: string[];
    recentSystemSignals: string[];
}

export interface MvpShapedContext {
    prompt: string;
    sections: MvpContextSection[];
}

export interface MvpContextSection {
    title: string;
    lines: string[];
    tier: MvpContextTier;
    relevanceScore: number;
    referenceCount: number;
    updatedAtMs?: number;
    freshnessScore?: number;
}

export interface MvpPlannerDecision {
    taskType: MvpTaskType;
    nextAction: MvpPlannerAction;
    instructions: string[];
}

export interface MvpVerificationLocation {
    file: string;
    line: number;
    col?: number;
    message: string;
}

export interface MvpDistilledResult {
    passed: boolean;
    category: MvpErrorCategory;
    summary: string;
    locations: MvpVerificationLocation[];
    rawTruncated: boolean;
    originalCharCount: number;
    summaryTokenCount: number;
    compressionRatio: number;
    issueCount?: number;
    coveragePercent?: number;
}

export interface MvpVerifierRawOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    command: string;
    verifierType: MvpVerifierType;
}

export interface MvpVerificationCheckResult {
    name: MvpVerificationCheckName;
    status: 'passed' | 'failed' | 'skipped';
    summary: string;
    command?: string;
    output?: string;
    exitCode?: number;
    category?: MvpErrorCategory;
    locations?: MvpVerificationLocation[];
    rawTruncated?: boolean;
    originalCharCount?: number;
    summaryTokenCount?: number;
    compressionRatio?: number;
    issueCount?: number;
    coveragePercent?: number;
}

export interface MvpVerificationResult {
    ok: boolean;
    summary: string;
    digest: string;
    checks: MvpVerificationCheckResult[];
}

export interface MvpTestBaseline {
    timestamp: number;
    command: string;
    cwd: string;
    passed: number;
    failed: number;
    tests: Record<string, 'pass' | 'fail' | 'skip'>;
}

export interface MvpBaselineComparisonResult {
    hasRegression: boolean;
    regressions: string[];
    newPasses: string[];
    baseline: MvpTestBaseline;
    current: MvpTestBaseline;
}

export interface MvpBaselineSignal {
    status: MvpBaselineStatus;
    summary: string;
    command?: string;
    regressions: string[];
}

export interface MvpStopConditionConfig {
    hard: MvpHardStopCondition[];
    soft: MvpSoftStopCondition[];
    maxLoops: number;
    timeoutMs?: number;
}

export interface MvpStopEvaluationResult {
    shouldStop: boolean;
    reason: 'all_met' | 'hard_failed' | 'soft_unmet' | 'max_loops' | 'timeout';
    failedConditions: string[];
    loopCount: number;
}

export interface MvpRuntimeConfig {
    baselineCheck: boolean;
    baselineCheckRetries?: number;
    distillVerifier: boolean;
    stopConditions: MvpStopConditionConfig;
}

export type MvpFailureClassification =
    | 'permission'
    | 'path'
    | 'dependency'
    | 'timeout'
    | 'test'
    | 'lint'
    | 'build'
    | 'unknown';

export type MvpRecoveryAction = 'retry' | 'rollback' | 'replan';

export type MvpRecoveryOutcome = 'success' | 'failure';

export interface MvpFailurePattern {
    id: string;
    taskType: MvpTaskType;
    errorSignature: string;
    errorCategory: MvpFailureClassification;
    strategy: MvpRecoveryAction;
    outcome: MvpRecoveryOutcome;
    occurrences: number;
    lastSeenAt: number;
}

export interface MvpRecoveryDecision {
    classification: MvpFailureClassification;
    action: MvpRecoveryAction;
    summary: string;
    rollbackPointId?: string;
    fromMemory?: boolean;
}
