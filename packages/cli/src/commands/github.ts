// ============================================================
// xqoder github — GitHub Agent 管理（OpenCode 风格）
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';

const WORKFLOW_TEMPLATE = `name: XQoder Agent
on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  xqoder:
    if: contains(github.event.issue.labels.*.name, 'xqoder') || contains(github.event.comment.body, '@xqoder')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install XQoder
        run: npm install -g xqoder
      - name: Run XQoder Agent
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          XQODER_LLM_API_KEY: \${{ secrets.XQODER_LLM_API_KEY }}
        run: |
          xqoder github run --token "\$GITHUB_TOKEN"
`;

const githubCommand = new Command('github')
    .description('管理 GitHub agent，用于仓库自动化');

githubCommand
    .command('install')
    .description('在仓库中安装 GitHub agent（GitHub Actions workflow）')
    .option('--dir <dir>', '项目目录', '.')
    .action((opts: { dir: string }) => {
        const workflowDir = path.join(opts.dir, '.github', 'workflows');
        const workflowFile = path.join(workflowDir, 'xqoder.yml');

        if (fs.existsSync(workflowFile)) {
            logger.warn(`Workflow 文件已存在: ${workflowFile}`);
            logger.info('如需更新，请手动编辑或删除后重新安装');
            return;
        }

        fs.mkdirSync(workflowDir, { recursive: true });
        fs.writeFileSync(workflowFile, WORKFLOW_TEMPLATE, 'utf8');
        logger.success(`GitHub Actions workflow 已安装: ${workflowFile}`);
        logger.info('请确保在仓库 Settings > Secrets 中配置 XQODER_LLM_API_KEY');
    });

githubCommand
    .command('run')
    .description('运行 GitHub agent（通常在 GitHub Actions 中调用）')
    .option('--event <event>', 'GitHub event JSON 文件路径')
    .option('--token <token>', 'GitHub personal access token')
    .option('--dir <dir>', '项目目录', '.')
    .action(async (opts: { event?: string; token?: string; dir: string }) => {
        const token = opts.token ?? process.env['GITHUB_TOKEN'];
        if (!token) {
            logger.error('需要 GitHub token: --token <token> 或 GITHUB_TOKEN 环境变量');
            process.exit(1);
        }

        const eventPath = opts.event ?? process.env['GITHUB_EVENT_PATH'];
        if (!eventPath || !fs.existsSync(eventPath)) {
            logger.error('需要 GitHub event: --event <path> 或 GITHUB_EVENT_PATH 环境变量');
            process.exit(1);
        }

        try {
            const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
            const eventAction = eventData.action ?? 'unknown';
            logger.info(`处理 GitHub event: ${eventAction}`);

            const prompt = extractPromptFromEvent(eventData);
            if (!prompt) {
                logger.info('没有可处理的指令，跳过');
                return;
            }

            logger.info(`提取到指令: ${prompt.slice(0, 100)}...`);

            const { configManager, resolveConfigWithEnvOverrides } = await import('@xqoder/shared');
            const { XQoderAgent, buildAgentConfigFromXQoderConfig } = await import('@xqoder/agent');

            const { config } = resolveConfigWithEnvOverrides(configManager.load({ cwd: opts.dir }));
            const agentConfig = buildAgentConfigFromXQoderConfig(config, {
                cwd: opts.dir,
                projectRoot: opts.dir,
            });

            const agent = new XQoderAgent(agentConfig);
            try {
                const result = await agent.run(prompt, {
                    onToken: (token) => process.stdout.write(token),
                });
                process.stdout.write('\n');
                logger.success(`Agent 完成: ${result.slice(0, 200)}...`);
            } finally {
                await agent.dispose();
            }
        } catch (err) {
            logger.error(`GitHub agent 执行失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });

function extractPromptFromEvent(event: Record<string, unknown>): string | undefined {
    const comment = (event['comment'] as Record<string, unknown> | undefined)?.['body'] as string | undefined;
    if (comment?.includes('@xqoder')) {
        return comment.replace(/@xqoder/g, '').trim();
    }

    const issue = event['issue'] as Record<string, unknown> | undefined;
    if (issue) {
        const title = issue['title'] as string ?? '';
        const body = issue['body'] as string ?? '';
        return `Issue: ${title}\n\n${body}`.trim();
    }

    return undefined;
}

export const githubCommandExport = githubCommand;
