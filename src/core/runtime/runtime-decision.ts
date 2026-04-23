export type RuntimeExecutionMode = 'direct_response' | 'engineering_loop';

export interface RuntimeDecisionInput {
    kind: string;
    usesStructuredResponse: boolean;
    includesRuntimeIdentity: boolean;
    augmentsProjectContext: boolean;
}

export interface RuntimeDecision {
    executionMode: RuntimeExecutionMode;
    shouldUseStructuredResponse: boolean;
    shouldIncludeRuntimeIdentity: boolean;
    shouldAugmentProjectContext: boolean;
    runtimeProfile: 'mvp' | 'full' | 'hybrid';
}

export function resolveRuntimeDecision(input: RuntimeDecisionInput): RuntimeDecision {
    const executionMode: RuntimeExecutionMode = input.usesStructuredResponse
        ? 'engineering_loop'
        : 'direct_response';
    const runtimeProfile: RuntimeDecision['runtimeProfile'] = input.usesStructuredResponse
        ? 'hybrid'
        : 'mvp';

    return {
        executionMode,
        shouldUseStructuredResponse: input.usesStructuredResponse,
        shouldIncludeRuntimeIdentity: input.includesRuntimeIdentity,
        shouldAugmentProjectContext: input.augmentsProjectContext,
        runtimeProfile,
    };
}
