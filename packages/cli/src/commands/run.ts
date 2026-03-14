// ============================================================
// xqoder run — OpenCode 风格非交互模式（传递 prompt 直接执行）
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { logger, type MessageAttachment } from '@xqoder/shared';
import type { AgentSessionStore } from '@xqoder/storage-sqlite';
import { buildMessageAttachments } from '../tui/attachments.js';
import { runChatCommand } from './chat.js';

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
        .description('非交互模式运行：传递 prompt 直接执行（OpenCode 风格）')
        .argument('[message...]', '发送给 AI 的消息')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-c, --continue', '继续上次 session')
        .option('-s, --session <id>', '指定 session ID 继续')
        .option('--fork', 'fork session 后继续（与 --continue 或 --session 一起使用）')
        .option('--share', '分享 session')
        .option('-m, --model <model>', '模型，格式 provider/model')
        .option('-a, --agent <name>', '指定 agent')
        .option('-f, --file <path>', '附加文件到消息', (v: string, acc: string[]) => (acc ?? []).concat(v), [])
        .option('--format <format>', '输出格式: default | json', 'default')
        .option('--title <title>', 'session 标题')
        .option('--attach <url>', '连接运行中的 xqoder serve 实例')
        .option('--port <port>', '本地 server 端口（attach 时）')
        .action(async (messageParts: string[], options: RunCommandOptions) => {
            const message = messageParts?.join(' ').trim();
            if (!message) {
                logger.error('请提供消息，例如: xqoder run "解释这段代码"');
                process.exit(1);
            }

            if (options.attach) {
                logger.warn('--attach 暂未实现，将使用本地 agent');
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
                        logger.warn(`附件 ${i.filePath}: ${i.reason}`);
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
                logger.error(`run 失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const runCommand = createRunCommand();
