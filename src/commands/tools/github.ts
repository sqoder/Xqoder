// xqoder github — GitHub Agent Management (XQoder style)
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
    .description('Manage GitHub agent for repository automation');

githubCommand
    .command('install')
    .description('Install GitHub agent in repository (GitHub Actions workflow)')
    .option('--dir <dir>', 'Project directory', '.')
    .action((opts: { dir: string }) => {
        const workflowDir = path.join(opts.dir, '.github', 'workflows');
        const workflowFile = path.join(workflowDir, 'xqoder.yml');

        if (fs.existsSync(workflowFile)) {
            logger.warn(`Workflow file already exists: ${workflowFile}`);
            logger.info('To update, please edit manually or delete it and reinstall.');
            return;
        }

        fs.mkdirSync(workflowDir, { recursive: true });
        fs.writeFileSync(workflowFile, WORKFLOW_TEMPLATE, 'utf8');
        logger.success(`GitHub Actions workflow installed: ${workflowFile}`);
        logger.info('Ensure XQODER_LLM_API_KEY is configured in repository Settings > Secrets');
    });

githubCommand
    .command('run')
    .description('Run GitHub agent (usually called from GitHub Actions)')
    .option('--event <event>', 'GitHub event JSON file path')
    .option('--token <token>', 'GitHub personal access token')
    .option('--dir <dir>', 'Project directory', '.')
    .action(async (opts: { event?: string; token?: string; dir: string }) => {
        const token = opts.token ?? process.env['GITHUB_TOKEN'];
        if (!token) {
            logger.error('GitHub token required: --token <token> or GITHUB_TOKEN environment variable');
            process.exit(1);
        }

        const eventPath = opts.event ?? process.env['GITHUB_EVENT_PATH'];
        if (!eventPath || !fs.existsSync(eventPath)) {
            logger.error('GitHub event required: --event <path> or GITHUB_EVENT_PATH environment variable');
            process.exit(1);
        }

        try {
            const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
            const eventAction = eventData.action ?? 'unknown';
            logger.info(`Processing GitHub event: ${eventAction}`);

            const prompt = extractPromptFromEvent(eventData);
            if (!prompt) {
                logger.info('No processable instruction found, skipping');
                return;
            }

            logger.info(`Extracted instruction: ${prompt.slice(0, 100)}...`);

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
                logger.success(`Agent completed: ${result.slice(0, 200)}...`);
            } finally {
                await agent.dispose();
            }
        } catch (err) {
            logger.error(`GitHub agent execution failed: ${err instanceof Error ? err.message : String(err)}`);
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
