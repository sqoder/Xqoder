export type WorkflowMode = 'plan' | 'review' | 'automation';

const WORKFLOW_OUTPUT_CONTRACT = [
    'Output contract (must follow for this command family):',
    '- Use exactly these section titles in order:',
    '  WORKFLOW',
    '  INPUT_SUMMARY',
    '  ACTION_PLAN',
    '  RISKS_AND_CHECKS',
    '  NEXT_STEPS',
    '- Keep the response concise and actionable.',
].join('\n');

function modeInstruction(mode: WorkflowMode): string {
    switch (mode) {
        case 'plan':
            return [
                'Mode: PLAN',
                '- Produce an execution plan only; do not claim code changes were made.',
                '- Focus on dependency order, acceptance checks, and rollback points.',
            ].join('\n');
        case 'review':
            return [
                'Mode: REVIEW',
                '- Review the requested scope and prioritize concrete findings.',
                '- Call out severity (high/medium/low) and verification steps.',
            ].join('\n');
        case 'automation':
            return [
                'Mode: AUTOMATION',
                '- Design a repeatable automation workflow for the user goal.',
                '- Include trigger conditions, guardrails, and explicit stop conditions.',
            ].join('\n');
        default:
            return 'Mode: PLAN';
    }
}

export function buildWorkflowPrompt(
    mode: WorkflowMode,
    userInput: string,
): string {
    return [
        modeInstruction(mode),
        WORKFLOW_OUTPUT_CONTRACT,
        `User request: ${userInput}`,
    ].join('\n\n');
}

export function defaultAgentForWorkflowMode(mode: WorkflowMode): string {
    return mode === 'plan' ? 'plan' : 'coder';
}
