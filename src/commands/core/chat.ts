// ============================================================
// xqoder chat — General AI terminal dialogue
// ============================================================

import { Command } from 'commander';
import {
    type ChatRunOptions,
    runChat,
    type ChatServiceDependencies,
} from '../../application/chat/index.js';
import { createDefaultChatSessionStore } from '../../infrastructure/storage/index.js';
import { logger } from '@xqoder/shared';
import type { AgentCallbacks } from '@xqoder/agent';
import { createCliToolApprovalHandler, createCliToolStreamHandler } from '../../ux/tool-approval.js';

export type ChatCommandOptions = ChatRunOptions;

export interface ChatCommandDependencies extends ChatServiceDependencies {}

export async function runChatCommand(
    prompt: string,
    options: ChatCommandOptions,
    dependencies: ChatCommandDependencies = {},
): Promise<void> {
    await runChat(prompt, options, withDefaultChatDependencies(dependencies), () => createAgentCallbacks());
}

function createAgentCallbacks(): AgentCallbacks {
    return {
        onToken: (token) => process.stdout.write(token),
        onToolStart: (name) => logger.info(`[Agent] Calling tool: ${name}`),
        onToolEnd: (name, _, success) => {
            if (success) {
                logger.success(`[Agent] Tool completed: ${name}`);
                return;
            }
            logger.error(`[Agent] Tool failed: ${name}`);
        },
        onToolApproval: createCliToolApprovalHandler(),
        onToolStream: createCliToolStreamHandler(),
    };
}

export function createChatCommand(
    dependencies: ChatCommandDependencies = {},
): Command {
    return new Command('chat')
        .description('Chat with the AI assistant in the current project')
        .argument('<message>', 'Message to send to the AI assistant')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-m, --model <model>', 'AI model')
        .option('-a, --agent <name>', 'Specific agent name')
        .option('-s, --session <id>', 'Restore a specific session')
        .option('--new-session', 'Skip automatic session restoration, force create new session')
        .option('-f, --format <format>', 'Output format: text (default) or json', 'text')
        .action(async (message: string, options: ChatCommandOptions) => {
            try {
                await runChatCommand(message, options, dependencies);
            } catch (err) {
                logger.error(`Dialogue failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const chatCommand = createChatCommand();

function withDefaultChatDependencies(
    dependencies: ChatCommandDependencies,
): ChatCommandDependencies {
    if (dependencies.sessionStore || dependencies.createSessionStore) {
        return dependencies;
    }

    return {
        ...dependencies,
        createSessionStore: createDefaultChatSessionStore,
    };
}
