// ============================================================
// xqoder fix — AI Project Error Repair
// ============================================================

import { Command } from 'commander';
import { ConfigManager, WorkflowStatus, type XQoderConfig, configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { XQoderAgent, buildAgentConfigFromXQoderConfig } from '@xqoder/agent';
import { ProjectDetector, ProjectRuntime } from '@xqoder/runtime';
import {
    runFixProjectFlow,
    type FixProjectFlowRuntime,
    type RepairProjectInput,
} from '@xqoder/workflow';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../ux/tool-approval.js';

interface FixCommandOptions {
    dir: string;
    model?: string;
    agent?: string;
    maxAttempts: number;
}

interface FixCommandDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    runtimeFactory?: () => FixProjectFlowRuntime;
    repairProject?: (input: RepairProjectInput, context: {
        options: FixCommandOptions;
        config: XQoderConfig;
    }) => Promise<string>;
}

function createDefaultRepairProject(
    options: FixCommandOptions,
    config: XQoderConfig,
): (input: RepairProjectInput) => Promise<string> {
    return async (input: RepairProjectInput) => {
        const { attempt, maxAttempts, analysis, prompt } = input;

        logger.info(`🩺 Repair attempt ${attempt}/${maxAttempts}`);
        logger.warn(`Detected ${analysis.errors.length} error(s), calling Agent for repair`);

        const agent = new XQoderAgent(buildAgentConfigFromXQoderConfig(config, {
            agentName: options.agent ?? 'coder',
            cwd: options.dir,
            projectRoot: options.dir,
            modelOverride: options.model,
            promptAppendix: `You are XQoder, an AI coding assistant.
The project encountered errors during execution. Please fix the code based on the execution report and error summary:
- Read relevant source files
- Modify code to fix errors
- Do not change existing functionality
- Prioritize fixing startup failures, missing dependencies, configuration issues, and compilation errors
`,
        }));

        try {
            return await agent.run(prompt, {
                onToken: (token) => process.stdout.write(token),
                onToolStart: (name) => logger.info(`🔧 ${name}`),
                onToolEnd: (name, _, success) => {
                    if (success) logger.success(`✅ ${name}`);
                    else logger.error(`❌ ${name}`);
                },
                onToolApproval: createCliToolApprovalHandler(),
                onToolStream: createCliToolStreamHandler(),
            });
        } finally {
            await agent.dispose();
        }
    };
}

export async function runFixCommand(
    options: FixCommandOptions,
    dependencies: FixCommandDependencies = {},
): Promise<void> {
    logger.info('🔧 XQoder Fix — AI Error Repair');
    logger.info(`📁 Directory: ${options.dir}`);

    const loadedConfig = dependencies.configManager?.load({ cwd: options.dir }) ?? configManager.load({ cwd: options.dir });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const detector = new ProjectDetector();
    const projectConfig = detector.createConfig(options.dir);

    const defaultFixAgentConfig = buildAgentConfigFromXQoderConfig(config, {
        agentName: options.agent ?? 'coder',
        cwd: options.dir,
        projectRoot: options.dir,
        modelOverride: options.model,
    });

    if (!dependencies.repairProject && !defaultFixAgentConfig.llmConfig.apiKey.trim()) {
        throw new Error('LLM API Key not configured. Please run: xqoder config init --api-key <key>');
    }

    const repairProject = dependencies.repairProject
        ? (input: RepairProjectInput) => dependencies.repairProject!(input, { options, config })
        : createDefaultRepairProject(options, config);

    const flowResult = await runFixProjectFlow({
        userRequest: 'Fix project execution errors',
        projectConfig,
        maxAttempts: options.maxAttempts,
        runtimeFactory: dependencies.runtimeFactory ?? (() => new ProjectRuntime()),
        repairProject,
    });

    const latestAttempt = flowResult.attempts[flowResult.attempts.length - 1];
    const wasHealthy = flowResult.attempts.length === 1
        && latestAttempt
        && latestAttempt.initialAnalysis.errors.length === 0
        && !latestAttempt.repairOutput;

    if (flowResult.status !== WorkflowStatus.Completed) {
        if (latestAttempt?.verificationAnalysis?.summaryForAgent) {
            logger.error(latestAttempt.verificationAnalysis.summaryForAgent);
        } else if (latestAttempt?.initialAnalysis.summaryForAgent) {
            logger.error(latestAttempt.initialAnalysis.summaryForAgent);
        }

        throw new Error(flowResult.error ?? 'Verification failed after maximum repair attempts');
    }

    if (wasHealthy) {
        logger.success('✅ No errors detected! Project is running normally.');
    } else {
        logger.success(`🎉 Repair completed with ${flowResult.attempts.length} attempt(s)`);
    }

    if (flowResult.finalRunReport?.url) {
        logger.info(`🌐 Running at: ${flowResult.finalRunReport.url}`);
    }
}

export function createFixCommand(dependencies: FixCommandDependencies = {}): Command {
    return new Command('fix')
        .description('AI project error repair — run project, capture errors, auto-fix')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model')
        .option('-a, --agent <name>', 'Specific agent name')
        .option('--max-attempts <count>', 'Maximum repair attempts', parseInt, 3)
        .action(async (options: FixCommandOptions) => {
        try {
            await runFixCommand(options, dependencies);
        } catch (err) {
            logger.error(`Repair failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
        });
}

export const fixCommand = createFixCommand();
