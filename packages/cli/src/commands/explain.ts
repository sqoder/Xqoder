// ============================================================
// xqoder explain — AI 解释代码
// ============================================================

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { XQoderAgent, buildAgentConfigFromXQoderConfig } from '@xqoder/agent';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../agent-ux.js';

export const explainCommand = new Command('explain')
    .description('AI 解释代码 — 分析文件或代码片段')
    .argument('[file]', '要解释的文件路径')
    .option('-d, --dir <dir>', '项目目录', '.')
    .option('-m, --model <model>', 'AI 模型')
    .option('-a, --agent <name>', '指定 agent')
    .action(async (file: string | undefined, options: { dir: string; model?: string; agent?: string }) => {
        logger.info('📖 XQoder Explain — AI 代码解释');

        try {
            const resolvedDir = path.resolve(options.dir);
            const { config } = resolveConfigWithEnvOverrides(configManager.load({ cwd: resolvedDir }));

            let prompt: string;
            if (file) {
                const filePath = path.isAbsolute(file) ? file : path.resolve(resolvedDir, file);
                if (!fs.existsSync(filePath)) {
                    logger.error(`文件不存在: ${filePath}`);
                    process.exit(1);
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                prompt = `请解释以下代码文件 (${file}):\n\n\`\`\`\n${content}\n\`\`\`\n\n请详细解释：\n1. 这段代码的功能\n2. 关键的设计模式\n3. 重要的业务逻辑\n4. 可能的改进建议`;
            } else {
                prompt = `请分析当前项目目录 (${options.dir})，解释项目的整体结构和架构。`;
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
            logger.error(`解释失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
