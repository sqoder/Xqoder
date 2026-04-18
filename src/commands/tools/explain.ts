// ============================================================
// xqoder explain — AI Code Explainer
// ============================================================

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { XQoderAgent, buildAgentConfigFromXQoderConfig } from '@xqoder/agent';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../../ux/tool-approval.js';

export const explainCommand = new Command('explain')
    .description('AI Code Explainer — Analyze files or code snippets')
    .argument('[file]', 'Path to the file to explain')
    .option('-d, --dir <dir>', 'Project directory', '.')
    .option('-m, --model <model>', 'AI model')
    .option('-a, --agent <name>', 'Specify agent name')
    .action(async (file: string | undefined, options: { dir: string; model?: string; agent?: string }) => {
        logger.info('📖 XQoder Explain — AI Code Explanation');

        try {
            const resolvedDir = path.resolve(options.dir);
            const { config } = resolveConfigWithEnvOverrides(configManager.load({ cwd: resolvedDir }));

            let prompt: string;
            if (file) {
                const filePath = path.isAbsolute(file) ? file : path.resolve(resolvedDir, file);
                if (!fs.existsSync(filePath)) {
                    logger.error(`File not found: ${filePath}`);
                    process.exit(1);
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                prompt = `Please explain the following code file (${file}):\n\n\`\`\`\n${content}\n\`\`\`\n\nPlease explain in detail:\n1. The functionality of this code\n2. Key design patterns used\n3. Important business logic\n4. Possible suggestions for improvement`;
            } else {
                prompt = `Please analyze the current project directory (${options.dir}) and explain the overall project structure and architecture.`;
            }

            const agent = new XQoderAgent(buildAgentConfigFromXQoderConfig(config, {
                agentName: options.agent ?? 'explore',
                cwd: resolvedDir,
                projectRoot: resolvedDir,
                modelOverride: options.model,
            }));

            try {
                await agent.run(prompt, {
                    onToken: (token) => process.stdout.write(token),
                    onToolApproval: createCliToolApprovalHandler(),
                    onToolStream: createCliToolStreamHandler(),
                });
            } finally {
                await agent.dispose();
            }

            console.log('\n');
        } catch (err) {
            logger.error(`Explanation failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
