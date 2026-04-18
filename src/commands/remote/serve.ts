// xqoder serve — Headless HTTP Service (XQoder style)
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/agent';
import type { AppEvent } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import type {
    AgentConversationPort,
    AgentQuestionAnswer,
    AgentQuestionRequest,
} from '../../application/agent/index.js';
import { createServer } from '../../interfaces/http/index.js';
import { TuiAgentService } from '../../infrastructure/agent/index.js';
import { FileSessionShareStore } from '../../features/sessions/assets.js';

export interface ServeCommandOptions {
    port?: string;
    hostname?: string;
    dir: string;
    mdns?: boolean;
    cors?: string;
}

export interface ServeRuntimeOptions {
    cwd: string;
    port: number;
    hostname: string;
    cors: string[];
    password?: string;
    username: string;
}

export function assertServeDirectoryWritable(
    cwd: string,
    dependencies: {
        existsSync?: (path: string) => boolean;
        accessSync?: (path: string, mode?: number) => void;
        writableMode?: number;
    } = {},
): void {
    const existsSync = dependencies.existsSync ?? fs.existsSync;
    const accessSync = dependencies.accessSync ?? fs.accessSync;
    const writableMode = dependencies.writableMode ?? fs.constants.W_OK;

    if (!existsSync(cwd)) {
        throw new Error(`Project directory does not exist: ${cwd}`);
    }

    try {
        accessSync(cwd, writableMode);
    } catch {
        throw new Error(`Project directory is not writable, session will not persist: ${cwd}`);
    }
}

export function resolveServeRuntimeOptions(
    options: ServeCommandOptions,
    serverConfig: { port?: number; hostname?: string; cors?: string[] } = {},
    env: NodeJS.ProcessEnv = process.env,
): ServeRuntimeOptions {
    const cwd = path.resolve(options.dir);
    const parsedPort = options.port ? Number.parseInt(options.port, 10) : Number.NaN;

    return {
        cwd,
        port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : (serverConfig.port ?? 4096),
        hostname: options.hostname?.trim() || serverConfig.hostname || '127.0.0.1',
        cors: options.cors
            ? options.cors.split(',').map((s) => s.trim()).filter(Boolean)
            : (serverConfig.cors ?? []),
        password: env.XQODER_SERVER_PASSWORD,
        username: env.XQODER_SERVER_USERNAME ?? 'xqoder',
    };
}

export const serveCommand = new Command('serve')
    .description('Start headless HTTP service for remote attach')
    .option('-p, --port <port>', 'Listen port')
    .option('--hostname <host>', 'Listen address')
    .option('--mdns', 'Enable mDNS discovery')
    .option('--cors <origins>', 'Allowed CORS origins, comma-separated')
    .option('-d, --dir <dir>', 'Project directory', '.')
    .action(async (options: ServeCommandOptions) => {
        const cwd = path.resolve(options.dir);
        try {
            assertServeDirectoryWritable(cwd);
        } catch (error) {
            logger.error(error instanceof Error ? error.message : String(error));
            if (error instanceof Error && error.message.includes('not writable')) {
                logger.info('Please use a writable directory (e.g. -d .) or check permissions.');
            }
            process.exit(1);
        }
        const loadedConfig = configManager.load({ cwd });
        const { config } = resolveConfigWithEnvOverrides(loadedConfig);
        const runtimeOptions = resolveServeRuntimeOptions(options, config.server);

        // Use project-local session DB to avoid ~/.xqoder being read-only (which causes "attempt to write a readonly database")
        const sessionDbFile = path.join(runtimeOptions.cwd, '.xqoder', 'data', 'sessions.sqlite');
        const sessionStore = new SQLiteSessionStore(sessionDbFile);
        const shareStore = new FileSessionShareStore(path.join(runtimeOptions.cwd, '.xqoder', 'data', 'shares'));
        const agentServices = new Map<string, AgentConversationPort>();

        const getAgentService = (sessionId: string): AgentConversationPort => {
            const existing = agentServices.get(sessionId);
            if (existing) {
                return existing;
            }
            const created = new TuiAgentService(sessionStore);
            agentServices.set(sessionId, created);
            return created;
        };
        const defaultModel = config.llm?.model ?? 'openai/gpt-4o';
        const runMessage = async (params: {
            projectRoot: string;
            sessionId: string;
            message: string;
            attachments?: import('@xqoder/shared').MessageAttachment[];
        }) => {
            let response = '';
            const loaded = configManager.load({ cwd: params.projectRoot });
            const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loaded);
            const model = effectiveConfig.llm?.model ?? defaultModel;
            const agent = effectiveConfig.defaultAgent ?? 'general';
            const agentService = getAgentService(params.sessionId);

            const result = await agentService.sendMessage(
                params.message,
                params.sessionId,
                {
                    dir: params.projectRoot,
                    model,
                    agent,
                    sandboxMode: effectiveConfig.sandbox?.mode ?? 'project',
                },
                params.attachments ?? [],
                {
                    onEvent: (event: AppEvent) => {
                        if (event.type === 'message.completed' && event.message.role === 'assistant') {
                            response = event.message.content;
                        }
                    },
                    onQuestion: async (request: AgentQuestionRequest): Promise<AgentQuestionAnswer> => ({
                        requestId: request.requestId,
                        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
                    }),
                },
            );

            return {
                response,
                sessionId: result.sessionId,
            };
        };

        const runMessageStream = async (params: {
            projectRoot: string;
            sessionId: string;
            message: string;
            attachments?: import('@xqoder/shared').MessageAttachment[];
            onEvent: (event: AppEvent) => void;
            requestQuestion: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
            signal?: AbortSignal;
        }) => {
            let response = '';
            const loaded = configManager.load({ cwd: params.projectRoot });
            const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loaded);
            const model = effectiveConfig.llm?.model ?? defaultModel;
            const agent = effectiveConfig.defaultAgent ?? 'general';
            const agentService = getAgentService(params.sessionId);

            const onAbort = (): void => {
                agentService.cancel();
            };
            params.signal?.addEventListener('abort', onAbort);

            const streamPromise = agentService.sendMessage(
                params.message,
                params.sessionId,
                {
                    dir: params.projectRoot,
                    model,
                    agent,
                    sandboxMode: effectiveConfig.sandbox?.mode ?? 'project',
                },
                params.attachments ?? [],
                {
                    onEvent: (event) => {
                        params.onEvent(event as AppEvent);
                        if (event.type === 'message.completed' && event.message.role === 'assistant') {
                            response = event.message.content;
                        }
                    },
                    onQuestion: async (request: AgentQuestionRequest): Promise<AgentQuestionAnswer> =>
                        params.requestQuestion(request as QuestionPrompt) as Promise<QuestionAnswer>,
                },
            );

            const abortPromise = params.signal
                ? new Promise<never>((_, reject) => {
                    if (params.signal?.aborted) {
                        reject(params.signal.reason instanceof Error ? params.signal.reason : new Error('Stream aborted'));
                        return;
                    }
                    params.signal?.addEventListener('abort', () => {
                        reject(params.signal?.reason instanceof Error ? params.signal.reason : new Error('Stream aborted'));
                    }, { once: true });
                })
                : undefined;

            let result: Awaited<typeof streamPromise>;
            try {
                result = await (abortPromise
                    ? Promise.race([streamPromise, abortPromise])
                    : streamPromise);
            } finally {
                params.signal?.removeEventListener('abort', onAbort);
            }

            return {
                response,
                sessionId: result.sessionId,
            };
        };

        const server = createServer({
            port: runtimeOptions.port,
            hostname: runtimeOptions.hostname,
            cors: runtimeOptions.cors,
            password: runtimeOptions.password,
            username: runtimeOptions.username,
            cwd: runtimeOptions.cwd,
            defaultModel,
            sessionStore,
            runMessage,
            runMessageStream,
            shareStore,
        });

        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`Port ${runtimeOptions.port} is already in use. Kill the process: lsof -i :${runtimeOptions.port}, or use a different port: -p 4097`);
                process.exit(1);
            }
            throw err;
        });
        server.on('listening', () => {
            const addr = server.address();
            const portNum = typeof addr === 'object' && addr ? addr.port : runtimeOptions.port;
            logger.success(`XQoder serve started: http://${runtimeOptions.hostname}:${portNum}`);
            logger.info(`  /global/health — Health check`);
            logger.info(`  /doc — API Documentation`);
            logger.info(`  GET/POST /session — List/Create session`);
            logger.info(`  POST /session/:id/message — Send message`);
            logger.info(`  POST /session/:id/message/stream — Message stream events`);
            logger.info(`  POST /session/:id/question/:requestId/resolve — Resolve question`);
            logger.info(`  POST /session/:id/stream/:streamId/cancel — Cancel streaming request`);
        });

        const shutdown = () => {
            logger.info('Shutting down service...');
            server.close(() => {
                logger.success('Service shut down safely');
                process.exit(0);
            });
            void Promise.all(Array.from(agentServices.values(), (service) => service.dispose()));
            setTimeout(() => {
                logger.warn('Shutdown timed out, forcing exit');
                process.exit(1);
            }, 5000).unref();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
