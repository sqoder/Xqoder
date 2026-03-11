// ============================================================
// xqoder chat — 通用 AI 终端对话（Day 34 薄入口：参数解析 + 调用 service）
// ============================================================

import { Command } from 'commander';
import {
    type ChatRunOptions,
    runChat,
    type ChatServiceDependencies,
} from '../services/chat-service.js';
import { logger } from '@xqoder/shared';
import type { AgentCallbacks } from '@xqoder/agent';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../agent-ux.js';

export type ChatCommandOptions = ChatRunOptions;

export interface ChatCommandDependencies extends ChatServiceDependencies {}

export async function runChatCommand(
    prompt: string,
    options: ChatCommandOptions,
    dependencies: ChatCommandDependencies = {},
): Promise<void> {
    await runChat(prompt, options, dependencies, () => createAgentCallbacks());
}

function createAgentCallbacks(): AgentCallbacks {
    return {
        onToken: (token) => process.stdout.write(token),
        onToolStart: (name) => logger.info(`[Agent] 调用工具: ${name}`),
        onToolEnd: (name, _, success) => {
            if (success) {
                logger.success(`[Agent] 完成工具: ${name}`);
                return;
            }
            logger.error(`[Agent] 工具失败: ${name}`);
        },
        onToolApproval: createCliToolApprovalHandler(),
        onToolStream: createCliToolStreamHandler(),
    };
}

export function createChatCommand(
    dependencies: ChatCommandDependencies = {},
): Command {
    return new Command('chat')
        .description('与当前项目中的 AI 助手对话')
        .argument('<message>', '发送给 AI 助手的消息')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-m, --model <model>', 'AI 模型')
        .option('-a, --agent <name>', '指定 agent')
        .option('-s, --session <id>', '恢复指定 session')
        .option('--new-session', '跳过自动续接，强制创建新会话')
        .option('-f, --format <format>', '输出格式: text (默认) 或 json', 'text')
        .action(async (message: string, options: ChatCommandOptions) => {
            try {
                await runChatCommand(message, options, dependencies);
            } catch (err) {
                logger.error(`对话失败: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const chatCommand = createChatCommand();
