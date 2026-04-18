// xqoder run — Non-interactive mode (execute prompt directly)
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { logger, type MessageAttachment } from '@xqoder/shared';
import type { AgentSessionStore } from '@xqoder/storage-sqlite';
import { buildMessageAttachments } from '../../application/chat/attachments.js';
import { runChatCommand } from '../core/chat.js';

interface RunCommandOptions {
    dir: string;
    model?: string;
    agent?: string;
    session?: string;
    continue?: boolean;
    fork?: boolean;
    share?: boolean;
    format?: 'default' | 'json';
    title?: string;
    attach?: string;
    port?: number;
    file?: string[];
}

export function createRunCommand(
    dependencies: { sessionStore?: AgentSessionStore } = {},
): Command {
    return new Command('run')
        .description('Run in non-interactive mode: execute prompt directly (XQoder style)')
        .argument('[message...]', 'Message to send to AI')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-c, --continue', 'Continue last session')
        .option('-s, --session <id>', 'Continue with specific session ID')
        .option('--fork', 'Fork session before continuing (used with --continue or --session)')
        .option('--share', 'Share session')
        .option('-m, --model <model>', 'Model, format: provider/model')
        .option('-a, --agent <name>', 'Specify agent')
        .option('-f, --file <path>', 'Attach file(s) to message', (v: string, acc: string[]) => (acc ?? []).concat(v), [])
        .option('--format <format>', 'Output format: default | json', 'default')
        .option('--title <title>', 'Session title')
        .option('--attach <url>', 'Connect to running xqoder serve instance')
        .option('--port <port>', 'Local server port (when using attach)')
        .action(async (messageParts: string[], options: RunCommandOptions) => {
            const message = messageParts?.join(' ').trim();
            if (!message) {
                logger.error('Please provide a message, e.g.: xqoder run "explain this code"');
                process.exit(1);
            }

            if (options.attach) {
                logger.warn('--attach not implemented yet, using local agent');
            }

            try {
                const resolvedDir = path.resolve(options.dir);
                const newSession = !options.continue && !options.session;
                const sessionId = options.session ?? undefined;
                const filePaths = options.file ?? [];
                const { attachments, issues } = filePaths.length > 0
                    ? buildMessageAttachments(filePaths)
                    : { attachments: [] as MessageAttachment[], issues: [] };
                if (issues.length > 0) {
                    for (const i of issues) {
                        logger.warn(`Attachment ${i.filePath}: ${i.reason}`);
                    }
                }

                await runChatCommand(message, {
                    dir: resolvedDir,
                    model: options.model,
                    agent: options.agent,
                    session: sessionId,
                    newSession,
                    attachments: attachments.length > 0 ? attachments : undefined,
                }, dependencies);
            } catch (err) {
                logger.error(`run failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const runCommand = createRunCommand();
