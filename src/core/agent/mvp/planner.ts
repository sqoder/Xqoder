import type {
    AgentRuntimeProfile,
    MvpCollectedContext,
    MvpPlannerDecision,
    MvpPlannerAction,
    MvpShapedContext,
} from './types.js';
import { isGitHubRepositoryUrl } from '../github-repo-url.js';

export function planMvpTurn(input: {
    context: MvpCollectedContext;
    hasBlockingVerification: boolean;
    hasPendingWrites: boolean;
    runtimeProfile?: AgentRuntimeProfile;
}): MvpPlannerDecision {
    const nextAction = selectNextAction(input.context, input.hasBlockingVerification, input.hasPendingWrites);
    const instructions: string[] = [
        'Work in the smallest safe diff; do not refactor unrelated code.',
        shouldAnswerInChinese(input.context.userGoal)
            ? 'Answer in Chinese. The user wrote in Chinese or explicitly requested Chinese, so the final response must be Chinese even if inspected source files use English.'
            : 'Answer in the same language as the user unless project instructions explicitly require another language.',
        input.runtimeProfile === 'hybrid'
            ? 'You are in hybrid runtime mode: full toolset is available, but keep the same verify-before-finish discipline.'
            : 'Use only these tools in MVP mode: list_files, read_file, search_code, inspect_github_repo, fetch_url, websearch, sourcegraph, write_file, run_shell.',
        'For bugfix/feature/refactor work, search or read first, then edit.',
        'When the user provides an http(s) URL, treat it as an external URL rather than a local file path: for GitHub repository URLs use inspect_github_repo first; for ordinary web URLs use fetch_url first.',
        'If a target path is a directory, do not call read_file on the directory itself; start with list_files or search_code on that directory, then read README/package manifests/config/entry files as needed.',
        'When analyzing a directory or repository, do not speculate from folder names alone. Describe only what inspected files or listings support, and say the evidence is insufficient when it is not explicit.',
        'Treat rm, destructive shell commands, and config writes as confirmation-required.',
        'After each write_file, expect the runtime to run verification automatically; do not claim success before it passes.',
    ];

    if (input.context.targetPaths.length > 0) {
        instructions.push(`Prefer these paths first: ${input.context.targetPaths.join(', ')}`);
    }

    if (input.context.targetUrls.length > 0) {
        instructions.push(`Prefer these URLs first: ${input.context.targetUrls.join(', ')}`);
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
        if (context.targetUrls.length > 0) {
            return context.targetUrls.some(isGitHubRepositoryUrl)
                ? 'inspect_github_repo'
                : 'fetch_url';
        }
        if (hasDirectoryTarget(context)) {
            return 'list_files';
        }
        return context.targetPaths.length > 0 ? 'read_file' : 'answer';
    }

    if (context.targetPaths.length > 0) {
        if (hasDirectoryTarget(context)) {
            return 'list_files';
        }
        return 'read_file';
    }

    return 'search_code';
}

function hasDirectoryTarget(context: MvpCollectedContext): boolean {
    return context.targetPaths.some((targetPath) => context.targetPathKinds[targetPath] === 'directory');
}

function shouldAnswerInChinese(userGoal: string): boolean {
    return /[\u3400-\u9fff]/.test(userGoal)
        || /(?:用|以)?中文(?:回答|回复)?/i.test(userGoal);
}
