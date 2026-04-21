import type {
    AgentRuntimeProfile,
    MvpCollectedContext,
    MvpPlannerDecision,
    MvpPlannerAction,
    MvpShapedContext,
} from './types.js';

export function planMvpTurn(input: {
    context: MvpCollectedContext;
    hasBlockingVerification: boolean;
    hasPendingWrites: boolean;
    runtimeProfile?: AgentRuntimeProfile;
}): MvpPlannerDecision {
    const nextAction = selectNextAction(input.context, input.hasBlockingVerification, input.hasPendingWrites);
    const instructions: string[] = [
        'Work in the smallest safe diff; do not refactor unrelated code.',
        input.runtimeProfile === 'hybrid'
            ? 'You are in hybrid runtime mode: full toolset is available, but keep the same verify-before-finish discipline.'
            : 'Use only these tools in MVP mode: read_file, search_code, write_file, run_shell.',
        'For bugfix/feature/refactor work, search or read first, then edit.',
        'Treat rm, destructive shell commands, and config writes as confirmation-required.',
        'After each write_file, expect the runtime to run verification automatically; do not claim success before it passes.',
    ];

    if (input.context.targetPaths.length > 0) {
        instructions.push(`Prefer these paths first: ${input.context.targetPaths.join(', ')}`);
    }

    if (input.context.relatedPaths.length > 0) {
        instructions.push(`Check likely callers or neighbors after the target path: ${input.context.relatedPaths.join(', ')}`);
    }

    if (input.hasBlockingVerification) {
        instructions.push('Latest verification failed. Continue fixing the failure instead of ending the task.');
    }

    if (input.context.taskType === 'question') {
        instructions.push('If this is only a question, inspect the codebase and answer directly without writing files.');
    }

    return {
        taskType: input.context.taskType,
        nextAction,
        instructions,
    };
}

export function renderMvpPlannerPrompt(
    context: MvpShapedContext,
    plan: MvpPlannerDecision,
): string {
    return [
        context.prompt,
        '',
        'Planner decision:',
        `- Task type: ${plan.taskType}`,
        `- Preferred next action: ${plan.nextAction}`,
        ...plan.instructions.map((instruction) => `- ${instruction}`),
    ].join('\n');
}

function selectNextAction(
    context: MvpCollectedContext,
    hasBlockingVerification: boolean,
    hasPendingWrites: boolean,
): MvpPlannerAction {
    if (hasBlockingVerification) {
        return 'write_file';
    }

    if (hasPendingWrites) {
        return 'run_shell';
    }

    if (context.taskType === 'question') {
        return context.targetPaths.length > 0 ? 'read_file' : 'answer';
    }

    if (context.targetPaths.length > 0) {
        return 'read_file';
    }

    return 'search_code';
}
