// ============================================================
// xqoder acp — Agent Client Protocol 服务（OpenCode 风格）
// stdin/stdout nd-JSON 协议，用于 IDE/编辑器集成
// ============================================================

import * as readline from 'node:readline';
import { Command } from 'commander';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    logger,
} from '@xqoder/shared';
import {
    XQoderAgent,
    buildAgentConfigFromXQoderConfig,
} from '@xqoder/agent';

interface AcpRequest {
    id: string;
    method: string;
    params?: Record<string, unknown>;
}

interface AcpResponse {
    id: string;
    result?: unknown;
    error?: { code: number; message: string };
}

function sendResponse(response: AcpResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
}

export const acpCommand = new Command('acp')
    .description('启动 ACP (Agent Client Protocol) 服务，通过 stdin/stdout 使用 nd-JSON')
    .option('--cwd <dir>', '工作目录', '.')
    .action(async (opts: { cwd: string }) => {
        const cwd = opts.cwd;
        const loadedConfig = configManager.load({ cwd });
        const { config } = resolveConfigWithEnvOverrides(loadedConfig);

        const agentConfig = buildAgentConfigFromXQoderConfig(config, {
            cwd,
            projectRoot: cwd,
        });

        let agent: XQoderAgent | null = null;

        const rl = readline.createInterface({
            input: process.stdin,
            terminal: false,
        });

        sendResponse({
            id: 'init',
            result: { version: '1.0', capabilities: ['chat', 'tools'] },
        });

        rl.on('line', async (line) => {
            let request: AcpRequest;
            try {
                request = JSON.parse(line) as AcpRequest;
            } catch {
                sendResponse({ id: 'unknown', error: { code: -32700, message: 'Parse error' } });
                return;
            }

            try {
                switch (request.method) {
                    case 'chat': {
                        const message = String(request.params?.message ?? '');
                        if (!message.trim()) {
                            sendResponse({ id: request.id, error: { code: -32602, message: 'Missing message param' } });
                            return;
                        }

                        if (!agent) {
                            agent = new XQoderAgent(agentConfig);
                        }

                        const tokens: string[] = [];
                        const response = await agent.run(message, {
                            onToken: (token) => {
                                tokens.push(token);
                                process.stdout.write(JSON.stringify({
                                    id: request.id,
                                    result: { type: 'token', content: token },
                                }) + '\n');
                            },
                        });

                        sendResponse({ id: request.id, result: { type: 'complete', content: response } });
                        break;
                    }
                    case 'reset': {
                        await agent?.dispose();
                        agent = new XQoderAgent(agentConfig);
                        sendResponse({ id: request.id, result: { status: 'ok' } });
                        break;
                    }
                    case 'ping': {
                        sendResponse({ id: request.id, result: { status: 'pong' } });
                        break;
                    }
                    case 'shutdown': {
                        await agent?.dispose();
                        sendResponse({ id: request.id, result: { status: 'ok' } });
                        process.exit(0);
                        break;
                    }
                    default:
                        sendResponse({ id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } });
                }
            } catch (err) {
                sendResponse({
                    id: request.id,
                    error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
                });
            }
        });

        rl.on('close', async () => {
            await agent?.dispose();
            process.exit(0);
        });

        logger.info('ACP 服务已启动，等待 stdin 请求...');
    });
