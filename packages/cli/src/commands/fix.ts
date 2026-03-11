// ============================================================
// xqoder fix — AI 修复项目错误
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
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../agent-ux.js';

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

        logger.info(`🩺 第 ${attempt}/${maxAttempts} 次修复尝试`);
        logger.warn(`检测到 ${analysis.errors.length} 个错误，开始调用 Agent 修复`);

        const agent = new XQoderAgent(buildAgentConfigFromXQoderConfig(config, {
            agentName: options.agent ?? 'coder',
            cwd: options.dir,
            projectRoot: options.dir,
            modelOverride: options.model,
            promptAppendix: `你是 XQoder，一个 AI 编程助手。
项目运行出错，请根据运行报告和错误摘要修复代码：
- 读取相关源文件
- 修改代码修复错误
- 不要改变原有功能
- 优先修复启动失败、缺失依赖、配置问题和编译错误
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
    logger.info('🔧 XQoder Fix — AI 错误修复');
    logger.info(`📁 目录: ${options.dir}`);

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
        throw new Error('LLM API Key 未配置，请先运行 xqoder config init --api-key <key>');
    }

    const repairProject = dependencies.repairProject
        ? (input: RepairProjectInput) => dependencies.repairProject!(input, { options, config })
        : createDefaultRepairProject(options, config);

    const flowResult = await runFixProjectFlow({
        userRequest: '修复项目运行错误',
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

        throw new Error(flowResult.error ?? '达到最大修复次数仍未通过验证');
    }

    if (wasHealthy) {
        logger.success('✅ 未检测到错误！项目运行正常。');
    } else {
        logger.success(`🎉 修复完成，共进行了 ${flowResult.attempts.length} 次尝试`);
    }

    if (flowResult.finalRunReport?.url) {
        logger.info(`🌐 运行地址: ${flowResult.finalRunReport.url}`);
    }
}

export function createFixCommand(dependencies: FixCommandDependencies = {}): Command {
    return new Command('fix')
        .description('AI 修复项目错误 — 运行项目、捕获错误、自动修复')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-m, --model <model>', 'AI 模型')
        .option('-a, --agent <name>', '指定 agent')
        .option('--max-attempts <count>', '最大修复尝试次数', parseInt, 3)
        .action(async (options: FixCommandOptions) => {
        try {
            await runFixCommand(options, dependencies);
        } catch (err) {
            logger.error(`修复失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
        });
}

export const fixCommand = createFixCommand();
