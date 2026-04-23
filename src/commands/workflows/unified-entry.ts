import * as path from 'node:path';
import { Command } from 'commander';
import { type OutputFormat, logger } from '@xqoder/shared';
import {
    runNonInteractivePrompt,
    type ChatServiceDependencies,
} from '../../application/chat/run-chat.js';
import {
    buildWorkflowPrompt,
    defaultAgentForWorkflowMode,
    type WorkflowMode,
} from '../../application/workflows/index.js';
import { createDefaultChatSessionStore } from '../../infrastructure/storage/index.js';
import { runListAgentsCommand } from '../core/agent.js';

interface WorkflowCommandOptions {
    dir: string;
    model?: string;
    agent?: string;
    format: OutputFormat;
    quiet?: boolean;
}

interface AgentsCommandOptions {
    dir: string;
    json?: boolean;
}

export interface UnifiedWorkflowDependencies extends ChatServiceDependencies {}

async function runWorkflowMode(
    mode: WorkflowMode,
    input: string,
    options: WorkflowCommandOptions,
    dependencies: UnifiedWorkflowDependencies = {},
): Promise<void> {
    const resolvedDir = path.resolve(options.dir);
    const prompt = mode === 'plan' || mode === 'review'
        ? `/${mode} ${input}`
        : buildWorkflowPrompt(mode, input);
    await runNonInteractivePrompt({
        prompt,
        cwd: resolvedDir,
        outputFormat: options.format ?? 'text',
        quiet: options.quiet ?? false,
        model: options.model,
        agent: options.agent ?? defaultAgentForWorkflowMode(mode),
    }, withDefaultChatDependencies(dependencies));
}

export function createPlanCommand(
    dependencies: UnifiedWorkflowDependencies = {},
): Command {
    return new Command('plan')
        .description('Unified workflow entry: produce an implementation plan with a fixed output contract')
        .argument('<goal>', 'Planning goal')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model override')
        .option('-a, --agent <name>', 'Agent name override')
        .option('-f, --format <format>', 'Output format: text or json', 'text')
        .option('-q, --quiet', 'Disable spinner/output noise')
        .action(async (goal: string, options: WorkflowCommandOptions) => {
            try {
                await runWorkflowMode('plan', goal, options, dependencies);
            } catch (error) {
                logger.error(`plan failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function createReviewCommand(
    dependencies: UnifiedWorkflowDependencies = {},
): Command {
    return new Command('review')
        .description('Unified workflow entry: run a scoped review with consistent report sections')
        .argument('<scope>', 'Review scope (files, module, or task)')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model override')
        .option('-a, --agent <name>', 'Agent name override')
        .option('-f, --format <format>', 'Output format: text or json', 'text')
        .option('-q, --quiet', 'Disable spinner/output noise')
        .action(async (scope: string, options: WorkflowCommandOptions) => {
            try {
                await runWorkflowMode('review', scope, options, dependencies);
            } catch (error) {
                logger.error(`review failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function createAutomationCommand(
    dependencies: UnifiedWorkflowDependencies = {},
): Command {
    return new Command('automation')
        .description('Unified workflow entry: design repeatable automation steps with guardrails')
        .argument('<goal>', 'Automation goal')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model override')
        .option('-a, --agent <name>', 'Agent name override')
        .option('-f, --format <format>', 'Output format: text or json', 'text')
        .option('-q, --quiet', 'Disable spinner/output noise')
        .action(async (goal: string, options: WorkflowCommandOptions) => {
            try {
                await runWorkflowMode('automation', goal, options, dependencies);
            } catch (error) {
                logger.error(`automation failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function createAgentsEntryCommand(): Command {
    return new Command('agents')
        .description('Unified workflow entry: list available agents (same source as `xqoder agent list`)')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('--json', 'Output in JSON format')
        .action((options: AgentsCommandOptions) => {
            runListAgentsCommand(
                { json: options.json ?? false },
                {
                    cwd: path.resolve(options.dir),
                    writeOutput: (output) => process.stdout.write(`${output}\n`),
                },
            );
        });
}

export const planCommand = createPlanCommand();
export const reviewCommand = createReviewCommand();
export const automationCommand = createAutomationCommand();
export const agentsEntryCommand = createAgentsEntryCommand();

function withDefaultChatDependencies(
    dependencies: UnifiedWorkflowDependencies,
): UnifiedWorkflowDependencies {
    if (dependencies.sessionStore || dependencies.createSessionStore) {
        return dependencies;
    }

    return {
        ...dependencies,
        createSessionStore: createDefaultChatSessionStore,
    };
}
