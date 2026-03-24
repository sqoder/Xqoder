// ============================================================
// @xqoder/workflow — 统一导出
// ============================================================

export { type IWorkflowStep, BaseStep } from './step.js';
export {
    WorkflowEngine,
    deriveDefaultFailureBucket,
    findLastFailedStep,
    type WorkflowCallbacks,
    type WorkflowResult,
} from './engine.js';
export { createBuildProjectSteps, type BuildWorkflowHandlers } from './templates/build-project.js';
export { createFixProjectSteps, type FixWorkflowHandlers } from './templates/fix-project.js';
export {
    deriveRemediationFailureBucket,
    normalizeRemediationFailureBucket,
    resolveRemediationMaxAttempts,
    resolveRemediationPolicy,
    type RemediationAttemptContext,
    type RemediationPolicy,
    type RemediationRetryStage,
    type ResolveRemediationPolicyInput,
} from './remediation-policy.js';
export {
    runBuildProjectFlow,
    type BuildProjectFlowRuntime,
    type BuildProjectFlowOptions,
    type BuildProjectFlowResult,
} from './flows/build-flow.js';
export {
    runFixProjectFlow,
    type FixProjectFlowRuntime,
    type FixProjectFlowOptions,
    type FixProjectFlowResult,
    type FixProjectFlowAttempt,
    type RepairProjectInput,
    type SafeAutomaticRemediationInput,
    type SafeAutomaticRemediationResult,
} from './flows/fix-flow.js';
export {
    runTestProjectFlow,
    type TestProjectFlowOptions,
    type TestProjectFlowResult,
} from './flows/test-flow.js';
export {
    runDeployProjectFlow,
    type DeployProjectFlowOptions,
    type DeployProjectFlowResult,
} from './flows/deploy-flow.js';
