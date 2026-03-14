// ============================================================
// xqoder serve — 无头 HTTP 服务（OpenCode 风格）
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/agent';
import type { AppEvent } from '@xqoder/protocol';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import { createServer } from '../server/index.js';
import { TuiAgentService } from '../tui/agent-service.js';
import { FileSessionShareStore } from '../session-assets.js';

export const serveCommand = new Command('serve')
    .description('启动无头 HTTP 服务，供 attach 使用')
    .option('-p, --port <port>', '监听端口', '4096')
    .option('--hostname <host>', '监听地址', '127.0.0.1')
    .option('--mdns', '启用 mDNS 发现')
    .option('--cors <origins>', '允许的 CORS 来源，逗号分隔')
    .option('-d, --dir <dir>', '项目目录', '.')
    .action(async (options: { port: string; hostname: string; dir: string; mdns?: boolean; cors?: string }) => {
        const cwd = path.resolve(options.dir);
        if (!fs.existsSync(cwd)) {
            logger.error(`项目目录不存在: ${cwd}`);
            process.exit(1);
        }
        try {
            fs.accessSync(cwd, fs.constants.W_OK);
        } catch {
            logger.error(`项目目录不可写，session 将无法持久化: ${cwd}`);
            logger.info('请换一个可写目录（如当前目录用 -d .）或检查权限。');
            process.exit(1);
        }
        const loadedConfig = configManager.load({ cwd });
        const { config } = resolveConfigWithEnvOverrides(loadedConfig);
        const serverConfig = config.server ?? {};
        const port = parseInt(options.port, 10) || (serverConfig.port ?? 4096);
        const hostname = options.hostname || (serverConfig.hostname ?? '127.0.0.1');
        const cors = options.cors
            ? options.cors.split(',').map((s) => s.trim()).filter(Boolean)
            : (serverConfig.cors ?? []);

        const password = process.env.XQODER_SERVER_PASSWORD;
        const username = process.env.XQODER_SERVER_USERNAME ?? 'xqoder';

        // 使用项目目录下的 session DB，避免依赖 ~/.xqoder 可写（只读时报 "attempt to write a readonly database"）
        const sessionDbFile = path.join(cwd, '.xqoder', 'data', 'sessions.sqlite');
        const sessionStore = new SQLiteSessionStore(sessionDbFile);
        const shareStore = new FileSessionShareStore(path.join(cwd, '.xqoder', 'data', 'shares'));
        const agentServices = new Map<string, TuiAgentService>();

        const getAgentService = (sessionId: string): TuiAgentService => {
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
                    onQuestion: async (request: QuestionPrompt): Promise<QuestionAnswer> => ({
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
                    onEvent: (event: AppEvent) => {
                        params.onEvent(event);
                        if (event.type === 'message.completed' && event.message.role === 'assistant') {
                            response = event.message.content;
                        }
                    },
                    onQuestion: params.requestQuestion,
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
            port,
            hostname,
            cors,
            password,
            username,
            cwd,
            defaultModel,
            sessionStore,
            runMessage,
            runMessageStream,
            shareStore,
        });

        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`端口 ${port} 已被占用。可先结束占用进程：lsof -i :${port}，或换端口：-p 4097`);
                process.exit(1);
            }
            throw err;
        });
        server.on('listening', () => {
            const addr = server.address();
            const portNum = typeof addr === 'object' && addr ? addr.port : port;
            logger.success(`XQoder serve 已启动: http://${hostname}:${portNum}`);
            logger.info(`  /global/health — 健康检查`);
            logger.info(`  /doc — API 文档`);
            logger.info(`  GET/POST /session — 列出/创建 session`);
            logger.info(`  POST /session/:id/message — 发消息`);
            logger.info(`  POST /session/:id/message/stream — 流式事件`);
            logger.info(`  POST /session/:id/question/:requestId/resolve — 回答 question`);
            logger.info(`  POST /session/:id/stream/:streamId/cancel — 取消流式请求`);
        });

        const shutdown = () => {
            logger.info('正在关闭服务...');
            server.close(() => {
                logger.success('服务已安全关闭');
                process.exit(0);
            });
            void Promise.all(Array.from(agentServices.values(), (service) => service.dispose()));
            setTimeout(() => {
                logger.warn('关闭超时，强制退出');
                process.exit(1);
            }, 5000).unref();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
