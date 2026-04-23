// xqoder run — Non-interactive mode (execute prompt directly)
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { logger, type MessageAttachment } from '@xqoder/shared';
import type { AgentSessionStore } from '@xqoder/storage-sqlite';
import type {
    RemoteAgentConversationPort,
    SendMessageCallbacks,
    TuiAgentSettings,
} from '../../application/agent/index.js';
import { buildMessageAttachments } from '../../application/chat/attachments.js';
import { RemoteTuiAgentService } from '../../infrastructure/agent/index.js';
import { runChatCommand } from '../core/chat.js';
import { runCreateShareCommand } from '../sessions/share.js';

export interface RunCommandOptions {
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

export interface RunCommandDependencies {
    sessionStore?: AgentSessionStore;
    runLocalCommand?: typeof runChatCommand;
    createRemoteAgentService?: (baseUrl: string) => RemoteAgentConversationPort;
    remoteCallbacksFactory?: () => SendMessageCallbacks;
    createShare?: (sessionId: string, projectRoot: string) => void | Promise<void>;
}

export function createRunCommand(
    dependencies: RunCommandDependencies = {},
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

            try {
                await runRunCommand(message, options, dependencies);
            } catch (err) {
                logger.error(`run failed: ${err instanceof Error ? err.message : String(err)}`);
                process.exit(1);
            }
        });
}

export const runCommand = createRunCommand();

export async function runRunCommand(
    message: string,
    options: RunCommandOptions,
    dependencies: RunCommandDependencies = {},
): Promise<void> {
    const resolvedDir = path.resolve(options.dir);
    const filePaths = options.file ?? [];
    const { attachments, issues } = filePaths.length > 0
        ? buildMessageAttachments(filePaths)
        : { attachments: [] as MessageAttachment[], issues: [] };

    for (const issue of issues) {
        logger.warn(`Attachment ${issue.filePath}: ${issue.reason}`);
    }

    if (options.attach) {
        if (options.share) {
            throw new Error('--share is not supported together with --attach');
        }
        await runAttachedCommand(message, options, dependencies, resolvedDir, attachments);
        return;
    }

    const newSession = !options.continue && !options.session;
    const sessionId = options.session ?? undefined;
    const result = await (dependencies.runLocalCommand ?? runChatCommand)(
        message,
        {
            dir: resolvedDir,
            model: options.model,
            agent: options.agent,
            session: sessionId,
            newSession,
            format: resolveOutputFormat(options.format),
            attachments: attachments.length > 0 ? attachments : undefined,
            title: options.title,
        },
        dependencies.sessionStore
            ? { sessionStore: dependencies.sessionStore }
            : {},
    );

    if (!options.share) {
        return;
    }

    await Promise.resolve(
        (dependencies.createShare ?? ((createdSessionId: string, projectRoot: string) => {
            runCreateShareCommand(createdSessionId, {
                dir: projectRoot,
                format: 'markdown',
            }, dependencies.sessionStore ? { sessionStore: dependencies.sessionStore } : {});
        }))(result.sessionId, resolvedDir),
    );
}

async function runAttachedCommand(
    message: string,
    options: RunCommandOptions,
    dependencies: RunCommandDependencies,
    resolvedDir: string,
    attachments: MessageAttachment[],
): Promise<void> {
    if (options.fork) {
        throw new Error('--fork is not supported together with --attach');
    }

    const outputFormat = resolveOutputFormat(options.format);
    const attachBaseUrl = resolveAttachBaseUrl(options.attach, options.port);
    const remoteService = dependencies.createRemoteAgentService?.(attachBaseUrl)
        ?? new RemoteTuiAgentService(attachBaseUrl);
    const responseCollector = createRemoteRunCallbacks(
        outputFormat,
        dependencies.remoteCallbacksFactory?.(),
    );
    const initialSessionId = options.session?.trim()
        ? options.session.trim()
        : options.continue
            ? undefined
            : (await remoteService.createSession(resolvedDir, options.title)).id;

    try {
        await remoteService.sendMessage(
            message,
            initialSessionId,
            {
                dir: resolvedDir,
                model: options.model ?? 'remote',
                agent: options.agent ?? 'general',
                sandboxMode: 'project',
            } satisfies TuiAgentSettings,
            attachments,
            responseCollector.callbacks,
        );
        if (outputFormat === 'json') {
            process.stdout.write(JSON.stringify(responseCollector.getResponse()));
        }
        process.stdout.write('\n');
    } finally {
        await remoteService.dispose();
    }
}

function resolveOutputFormat(
    format: RunCommandOptions['format'],
): 'text' | 'json' {
    return format === 'json' ? 'json' : 'text';
}

function resolveAttachBaseUrl(
    attach: string | undefined,
    port: number | undefined,
): string {
    if (!attach?.trim()) {
        throw new Error('--attach requires a target URL or hostname');
    }

    const normalized = /^https?:\/\//.test(attach.trim())
        ? attach.trim()
        : `http://${attach.trim()}`;
    const url = new URL(normalized);
    if (port !== undefined) {
        url.port = String(port);
    }
    return url.toString().replace(/\/$/, '');
}

function createRemoteRunCallbacks(
    outputFormat: 'text' | 'json',
    baseCallbacks?: SendMessageCallbacks,
): {
    callbacks: SendMessageCallbacks;
    getResponse: () => string;
} {
    let assistantStreamed = false;
    let assistantResponse = '';

    return {
        callbacks: {
            ...baseCallbacks,
            onEvent: (event) => {
                if (event.type === 'message.delta' && event.payload.role === 'assistant') {
                    assistantStreamed = true;
                    assistantResponse += event.payload.text;
                    if (outputFormat === 'text') {
                        process.stdout.write(event.payload.text);
                    }
                } else if (event.type === 'message.completed' && event.payload.message.role === 'assistant') {
                    assistantResponse = event.payload.message.content;
                    if (outputFormat === 'text' && !assistantStreamed) {
                        process.stdout.write(event.payload.message.content);
                    }
                } else if (event.type === 'tool.called') {
                    logger.info(`[Agent] Calling tool: ${event.payload.tool}`);
                } else if (event.type === 'tool.completed') {
                    if (event.payload.success) {
                        logger.success(`[Agent] Tool completed: ${event.payload.tool}`);
                    } else {
                        logger.error(`[Agent] Tool failed: ${event.payload.tool}`);
                    }
                } else if (event.type === 'error') {
                    logger.error(`[Agent] ${event.payload.message}`);
                }

                baseCallbacks?.onEvent(event);
            },
            ...(baseCallbacks?.onQuestion ? { onQuestion: baseCallbacks.onQuestion } : {}),
            ...(baseCallbacks?.onToolApproval ? { onToolApproval: baseCallbacks.onToolApproval } : {}),
        },
        getResponse: () => assistantResponse,
    };
}
