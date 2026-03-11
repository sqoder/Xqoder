// ============================================================
// xqoder build — AI 生成项目
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import {
    ConfigManager,
    type LSPServerConfig,
    type MCPServerConfig,
    ProjectType,
    TestStatus,
    WorkflowStatus,
    type LLMProviderConfig,
    type TestReport,
    configManager,
    logger,
    resolveConfigWithEnvOverrides,
} from '@xqoder/shared';
import { XQoderAgent, buildAgentConfigFromXQoderConfig, type AgentCallbacks } from '@xqoder/agent';
import { PackageManagerDetector, ProjectRuntime, ProjectTestRunner } from '@xqoder/runtime';
import {
    runBuildProjectFlow,
    type BuildProjectFlowRuntime,
} from '@xqoder/workflow';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../agent-ux.js';

interface BuildCommandOptions {
    dir: string;
    model?: string;
    agent?: string;
}

interface BuildCommandDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    agentFactory?: (config: {
        llmConfig: LLMProviderConfig;
        cwd: string;
        systemPrompt: string;
        sandboxMode?: 'project' | 'paths' | 'full-access';
        allowedPaths?: string[];
        mcpServers?: MCPServerConfig[];
        lspServers?: LSPServerConfig[];
    }) => {
        run(prompt: string, callbacks?: AgentCallbacks): Promise<string>;
        dispose?: () => Promise<void> | void;
    };
    runtimeFactory?: () => BuildProjectFlowRuntime;
    testProject?: (projectDir: string) => Promise<TestReport>;
    installDependencies?: (projectDir: string) => Promise<string>;
}

const BUILD_SYSTEM_PROMPT = `你是 XQoder，一个负责从零生成项目的 AI 编程助手。
你的目标是创建一个最小但完整、可以本地运行和测试的项目。

要求：
- 仅在当前项目目录内工作
- 生成真实可运行的代码，不要留下 TODO 占位
- 必须提供 package.json 和合理的 scripts
- 优先选择成熟、简单、稳定的技术栈
- 除非用户明确要求，否则不要增加额外复杂度`;

export async function runBuildCommand(
    description: string,
    options: BuildCommandOptions,
    dependencies: BuildCommandDependencies = {},
): Promise<void> {
    logger.info('🚀 XQoder Build — AI 项目生成');
    logger.info(`📝 需求: ${description}`);
    logger.info(`📁 目录: ${options.dir}`);

    const resolvedDir = path.resolve(options.dir);
    fs.mkdirSync(resolvedDir, { recursive: true });

    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent ?? 'coder',
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: BUILD_SYSTEM_PROMPT,
    });

    if (!dependencies.agentFactory && !agentConfig.llmConfig.apiKey.trim()) {
        throw new Error('LLM API Key 未配置，请先运行 xqoder config init --api-key <key>');
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? BUILD_SYSTEM_PROMPT,
        sandboxMode: agentConfig.sandboxMode,
        allowedPaths: agentConfig.allowedPaths,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const testProject = dependencies.testProject ?? (async (projectDir: string) => {
        const runner = new ProjectTestRunner();
        return runner.run(projectDir);
    });

    const installDependencies = dependencies.installDependencies
        ?? (async (projectDir: string) => installProjectDependencies(projectDir));

    try {
        const analysis = createRequirementsAnalysis(description);
        const result = await runBuildProjectFlow({
            userRequest: description,
            projectConfig: {
                rootDir: resolvedDir,
                type: ProjectType.Unknown,
                name: path.basename(resolvedDir),
            },
            analyzeRequirements: async () => analysis,
            generateStructure: async (requirementsAnalysis) => {
                return agent.run(buildStructurePrompt(description, requirementsAnalysis), createAgentCallbacks());
            },
            generateCode: async (requirementsAnalysis) => {
                return agent.run(buildCodePrompt(description, requirementsAnalysis), createAgentCallbacks());
            },
            installDependencies: async () => installDependencies(resolvedDir),
            runtimeFactory: dependencies.runtimeFactory ?? (() => new ProjectRuntime()),
            testProject,
        });

        if (result.status !== WorkflowStatus.Completed) {
            throw new Error(result.error ?? '项目生成失败');
        }

        logger.success('🎉 项目生成完成!');
        if (result.runReport?.url) {
            logger.info(`🌐 运行地址: ${result.runReport.url}`);
        }

        if (result.testReport?.status === TestStatus.Skipped) {
            logger.warn(`⚪ ${result.testReport.output}`);
        } else if (result.testReport?.status === TestStatus.Passed) {
            logger.success(`🧪 测试通过: ${result.testReport.passed} passed`);
        }
    } finally {
        await agent.dispose?.();
    }
}

export function createBuildCommand(
    dependencies: BuildCommandDependencies = {},
): Command {
    return new Command('build')
        .description('AI 生成项目 — 描述你想要的项目，XQoder 帮你创建')
        .argument('<description>', '项目描述（例如: "React 博客系统"）')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-m, --model <model>', 'AI 模型')
        .option('-a, --agent <name>', '指定 agent')
        .action(async (description: string, options: BuildCommandOptions) => {
            try {
                await runBuildCommand(description, options, dependencies);
            } catch (err) {
                logger.error(`项目生成失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const buildCommand = createBuildCommand();

function createRequirementsAnalysis(description: string): string {
    const framework = inferPreferredFramework(description);
    const stack = framework === 'nextjs'
        ? 'Next.js + React + TypeScript'
        : framework === 'vite'
            ? 'Vite + React + TypeScript'
            : 'Node.js';

    return [
        `用户需求: ${description}`,
        `推荐技术栈: ${stack}`,
        '交付要求:',
        '- 生成最小但完整的项目结构',
        '- 确保 package.json 包含可运行的 dev/build/test scripts',
        '- 默认生成易于维护的代码和基础说明',
    ].join('\n');
}

function inferPreferredFramework(description: string): 'nextjs' | 'vite' | 'node' {
    const normalized = description.toLowerCase();
    if (normalized.includes('next')) {
        return 'nextjs';
    }
    if (
        normalized.includes('vite')
        || normalized.includes('react')
        || normalized.includes('frontend')
        || normalized.includes('blog')
    ) {
        return 'vite';
    }
    return 'node';
}

function buildStructurePrompt(description: string, analysis: string): string {
    return [
        `用户需求: ${description}`,
        '',
        analysis,
        '',
        '任务：',
        '- 只创建项目目录结构和基础配置文件',
        '- 优先创建 package.json、tsconfig.json、入口文件和必要目录',
        '- 如果目录已经存在，请补齐缺失的结构，不要删除已有文件',
        '- 先搭出骨架，不要在这一步展开全部业务实现',
    ].join('\n');
}

function buildCodePrompt(description: string, analysis: string): string {
    return [
        `用户需求: ${description}`,
        '',
        analysis,
        '',
        '任务：',
        '- 在现有目录结构基础上补齐真实可运行代码',
        '- 确保项目可以通过 dev 命令启动',
        '- 如果适合，请补一个最小 smoke test 或 test script',
        '- 不要输出解释，直接修改项目文件并确保能运行',
    ].join('\n');
}

function createAgentCallbacks(): AgentCallbacks {
    return {
        onToken: (token) => process.stdout.write(token),
        onToolStart: (name) => logger.info(`🔧 ${name}`),
        onToolEnd: (name, _, success) => {
            if (success) {
                logger.success(`✅ ${name}`);
                return;
            }
            logger.error(`❌ ${name}`);
        },
        onToolApproval: createCliToolApprovalHandler(),
        onToolStream: createCliToolStreamHandler(),
    };
}

async function installProjectDependencies(projectDir: string): Promise<string> {
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return '未生成 package.json，跳过依赖安装';
    }

    const packageManagerDetector = new PackageManagerDetector();
    const packageManager = packageManagerDetector.detect(projectDir);
    const command = packageManager === 'pnpm'
        ? 'pnpm install'
        : packageManager === 'yarn'
            ? 'yarn install'
            : 'npm install';

    return new Promise<string>((resolve, reject) => {
        let output = '';
        const child = spawn('sh', ['-c', command], {
            cwd: projectDir,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
        });

        child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(`依赖安装完成: ${command}`);
                return;
            }

            reject(new Error(output.trim() || `依赖安装失败，退出码 ${code}`));
        });

        child.on('error', (error) => {
            reject(new Error(`依赖安装启动失败: ${error.message}`));
        });
    });
}
