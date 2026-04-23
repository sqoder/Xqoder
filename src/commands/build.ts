// ============================================================
// xqoder build — AI project generation
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
import { MISSING_API_KEY_GUIDANCE } from '../application/config/api-key-guidance.js';
import { llmProviderRequiresApiKey } from '../application/config/api-key-guidance.js';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../ux/tool-approval.js';

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

const BUILD_SYSTEM_PROMPT = `You are XQoder, an AI programming assistant responsible for generating projects from scratch.
Your goal is to create a minimal yet complete project that can run locally and be tested.

Requirements:
- Work only within the current project directory
- Generate real, runnable code; do not leave TODO placeholders
- Must provide package.json with reasonable scripts
- Prefer mature, simple, stable tech stacks
- Do not add unnecessary complexity unless explicitly requested by the user`;

export async function runBuildCommand(
    description: string,
    options: BuildCommandOptions,
    dependencies: BuildCommandDependencies = {},
): Promise<void> {
    logger.info('🚀 XQoder Build — AI Project Generation');
    logger.info(`📝 Requirements: ${description}`);
    logger.info(`📁 Directory: ${options.dir}`);

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
        runtimeProfile: 'mvp',
    });

    if (
        !dependencies.agentFactory
        && llmProviderRequiresApiKey(agentConfig.llmConfig.provider)
        && !agentConfig.llmConfig.apiKey.trim()
    ) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
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
            throw new Error(result.error ?? 'Project generation failed');
        }

        logger.success('🎉 Project generation complete!');
        if (result.runReport?.url) {
            logger.info(`🌐 Running at: ${result.runReport.url}`);
        }

        if (result.testReport?.status === TestStatus.Skipped) {
            logger.warn(`⚪ ${result.testReport.output}`);
        } else if (result.testReport?.status === TestStatus.Passed) {
            logger.success(`🧪 Tests passed: ${result.testReport.passed} passed`);
        }
    } finally {
        await agent.dispose?.();
    }
}

export function createBuildCommand(
    dependencies: BuildCommandDependencies = {},
): Command {
    return new Command('build')
        .description('AI project generation — describe your project and XQoder will create it for you')
        .argument('<description>', 'Project description (e.g., "React blog system")')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model')
        .option('-a, --agent <name>', 'Specify agent')
        .action(async (description: string, options: BuildCommandOptions) => {
            try {
                await runBuildCommand(description, options, dependencies);
            } catch (err) {
                logger.error(`Project generation failed: ${err instanceof Error ? err.message : String(err)}`);
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
        `User requirements: ${description}`,
        `Recommended tech stack: ${stack}`,
        'Delivery requirements:',
        '- Generate a minimal but complete project structure',
        '- Ensure package.json includes runnable dev/build/test scripts',
        '- Generate maintainable code with basic documentation by default',
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
        `User requirements: ${description}`,
        '',
        analysis,
        '',
        'Task:',
        '- Only create project directory structure and basic config files',
        '- Prioritize creating package.json, tsconfig.json, entry files and necessary directories',
        '- If the directory already exists, fill in missing structure without deleting existing files',
        '- Build the skeleton first, do not expand all business implementations in this step',
    ].join('\n');
}

function buildCodePrompt(description: string, analysis: string): string {
    return [
        `User requirements: ${description}`,
        '',
        analysis,
        '',
        'Task:',
        '- Fill in real runnable code on top of the existing directory structure',
        '- Ensure the project can start via the dev command',
        '- If appropriate, add a minimal smoke test or test script',
        '- Do not output explanations, directly modify project files and ensure they run',
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
        return 'package.json not generated, skipping dependency installation';
    }

    const packageManagerDetector = new PackageManagerDetector();
    const packageManager = packageManagerDetector.detect(projectDir);
    const command = packageManager === 'bun'
        ? 'bun install'
        : packageManager === 'pnpm'
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
                resolve(`Dependency installation complete: ${command}`);
                return;
            }

            reject(new Error(output.trim() || `Dependency installation failed, exit code ${code}`));
        });

        child.on('error', (error) => {
            reject(new Error(`Dependency installation failed to start: ${error.message}`));
        });
    });
}
