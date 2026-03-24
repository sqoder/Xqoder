// ============================================================
// xqoder acp — Agent Client Protocol 服务（OpenCode / ACP 规范）
// stdin/stdout nd-JSON，支持 initialize、session/*、agents/list
// ============================================================

import * as path from 'node:path';
import * as readline from 'node:readline';
import { Command } from 'commander';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    logger,
    type AgentPermissionMode,
    type PermissionSettings,
} from '@xqoder/shared';
import {
    type ClosableSessionStore,
    type AgentConfig,
    type XQoderAgentProviderOptions,
    buildAgentConfigFromXQoderConfig,
    SQLiteSessionStore,
    type RuntimeAgentSessionStore,
    listBuiltInAgents,
} from '@xqoder/agent';
import { InMemorySessionStore, RuntimeKernel, type SessionRecord } from '@xqoder/runtime';
import { buildChatSystemPrompt } from '../services/chat-service.js';
import { createRuntimeSessionKernel } from '../services/runtime-session-kernel.js';
import { resolveSessionForReuse } from '../services/session-resolve.js';
import { loadBuiltInRuntimePlugins } from '../tui/runtime-plugin-loader.js';

type AcpSessionStore = RuntimeAgentSessionStore & ClosableSessionStore;

/** ACP 请求（JSON-RPC 2.0 风格，id 可为 string 或 number） */
interface AcpRequest {
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

/** ACP 响应 */
interface AcpResponse {
    id?: string | number;
    result?: unknown;
    error?: { code: number; message: string };
}

/** session/update 通知（无 id） */
interface AcpNotification {
    method: 'session/update';
    params: {
        sessionId: string;
        update: {
            sessionUpdate: 'user_message_chunk' | 'agent_message_chunk';
            content: { type: 'text'; text: string };
        };
    };
}

interface AcpSessionDependencies {
    loadConfig?: Pick<typeof configManager, 'load'>['load'];
    createSessionStore?: (dbPath: string) => AcpSessionStore;
    createAgent?: XQoderAgentProviderOptions['createAgent'];
    emitUpdate?: (notification: AcpNotification) => void;
    emitToken?: (token: string) => void;
}

function sendResponse(response: AcpResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
}

function sendNotification(notification: AcpNotification): void {
    process.stdout.write(JSON.stringify(notification) + '\n');
}

const LIST_PAGE_SIZE = 20;
const VALID_PERMISSION_MODES: AgentPermissionMode[] = ['allow', 'ask', 'deny'];
const ACP_SLASH_COMMANDS = [
    '/session',
    '/resume',
    '/sessions',
    '/model',
    '/agent',
    '/sandbox',
    '/scope',
    '/share',
    '/compact',
    '/clear',
    '/help',
];

function getSessionDbPath(cwd: string): string {
    return path.join(path.resolve(cwd), '.xqoder', 'data', 'sessions.sqlite');
}

function readSessionTitle(record: SessionRecord): string | undefined {
    return record.title && record.title.length > 0 ? record.title : undefined;
}

function openAcpSessionStore(
    resolvedCwd: string,
    createSessionStore: AcpSessionDependencies['createSessionStore'] = (dbPath) => new SQLiteSessionStore(dbPath),
): AcpSessionStore {
    return createSessionStore(getSessionDbPath(resolvedCwd));
}

export async function runAcpSessionNew(
    params: Record<string, unknown> | undefined,
    baseCwd: string,
    dependencies: AcpSessionDependencies = {},
): Promise<{ sessionId: string }> {
    const cwd = (params?.cwd as string) || baseCwd;
    const resolvedCwd = path.resolve(cwd);
    const loadedConfig = (dependencies.loadConfig ?? configManager.load)({ cwd: resolvedCwd });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const model = config.llm?.model ?? 'openai/gpt-4o';
    const title = typeof params?.title === 'string' && params.title.trim().length > 0 ? params.title.trim() : undefined;
    const store = openAcpSessionStore(resolvedCwd, dependencies.createSessionStore);
    try {
        const kernel = createRuntimeSessionKernel(store, {
            projectRoot: resolvedCwd,
            model,
        });
        const record = await kernel.createSession({
            cwd: resolvedCwd,
            projectRoot: resolvedCwd,
            model,
            title,
        });
        return { sessionId: record.id };
    } finally {
        store.close();
    }
}

export async function runAcpSessionList(
    params: Record<string, unknown> | undefined,
    baseCwd: string,
    dependencies: AcpSessionDependencies = {},
): Promise<{ sessions: Array<{ sessionId: string; cwd: string; title?: string; updatedAt: string; _meta: unknown }>; nextCursor: undefined }> {
    const cwd = (params?.cwd as string) || baseCwd;
    const resolvedCwd = path.resolve(cwd);
    const limit = typeof params?.limit === 'number'
        ? Math.min(Math.max(1, params.limit), 100)
        : LIST_PAGE_SIZE;
    const store = openAcpSessionStore(resolvedCwd, dependencies.createSessionStore);
    try {
        const kernel = createRuntimeSessionKernel(store, {
            projectRoot: resolvedCwd,
            model: 'unknown',
        });
        const list = await kernel.listSessions({ projectRoot: resolvedCwd, limit });
        return {
            sessions: list.map((record) => ({
                sessionId: record.id,
                cwd: record.cwd,
                title: readSessionTitle(record),
                updatedAt: new Date(record.updatedAt).toISOString(),
                _meta: undefined as unknown,
            })),
            nextCursor: undefined,
        };
    } finally {
        store.close();
    }
}

export async function runAcpSessionPrompt(
    params: Record<string, unknown> | undefined,
    baseCwd: string,
    dependencies: AcpSessionDependencies = {},
): Promise<{ stopReason: 'complete' }> {
    const sessionId = params?.sessionId as string;
    const content = params?.content as unknown[];
    if (!sessionId || !Array.isArray(content)) {
        throw new Error('Missing sessionId or content');
    }

    const cwd = (params?.cwd as string) || baseCwd;
    const resolvedCwd = path.resolve(cwd);
    const prompt = contentBlocksToPrompt(content);
    if (!prompt.trim()) {
        throw new Error('Empty prompt content');
    }

    const loadedConfig = (dependencies.loadConfig ?? configManager.load)({ cwd: resolvedCwd });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const sandbox = config.sandbox ?? { mode: 'project', allowedPaths: [] };
    const store = openAcpSessionStore(resolvedCwd, dependencies.createSessionStore);
    const emitUpdate = dependencies.emitUpdate ?? sendNotification;

    try {
        const session = await resolveSessionForReuse(store, {
            projectRoot: resolvedCwd,
            sessionId,
            newSession: false,
        });
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        const agentConfig = buildAgentConfigFromXQoderConfig(config, {
            cwd: resolvedCwd,
            projectRoot: resolvedCwd,
            promptAppendix: buildChatSystemPrompt(sandbox),
            session,
        });

        const kernel = createRuntimeSessionKernel(store, {
            projectRoot: resolvedCwd,
            model: agentConfig.llmConfig.model,
        });
        let pendingAgentConfig: AgentConfig | null = null;
        await loadBuiltInRuntimePlugins(kernel, {
            resolveAgentConfig: async () => {
                if (!pendingAgentConfig) {
                    throw new Error('No pending agent configuration');
                }
                return pendingAgentConfig;
            },
            ...(dependencies.createAgent ? { createAgent: dependencies.createAgent } : {}),
        });
        pendingAgentConfig = {
            ...agentConfig,
            cwd: resolvedCwd,
            projectRoot: resolvedCwd,
            session,
        };

        let sawAssistantDelta = false;
        let runtimeError: Error | null = null;

        for await (const event of kernel.runAgent('xqoder-agent', {
            prompt,
            messages: [],
        }, {
            sessionId,
            cwd: resolvedCwd,
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        })) {
            if (event.type === 'message.delta' && event.role === 'assistant') {
                sawAssistantDelta = true;
                emitUpdate({
                    method: 'session/update',
                    params: {
                        sessionId,
                        update: {
                            sessionUpdate: 'agent_message_chunk',
                            content: { type: 'text', text: event.text },
                        },
                    },
                });
            }

            if (event.type === 'message.completed' && event.message.role === 'assistant' && !sawAssistantDelta) {
                emitUpdate({
                    method: 'session/update',
                    params: {
                        sessionId,
                        update: {
                            sessionUpdate: 'agent_message_chunk',
                            content: { type: 'text', text: event.message.content },
                        },
                    },
                });
            }

            if (event.type === 'error') {
                runtimeError = new Error(event.message);
            }
        }

        if (runtimeError) {
            throw runtimeError;
        }

        return { stopReason: 'complete' };
    } finally {
        store.close();
    }
}

export async function runAcpChat(
    params: Record<string, unknown> | undefined,
    baseCwd: string,
    dependencies: AcpSessionDependencies = {},
): Promise<{ type: 'complete'; content: string }> {
    const message = String(params?.message ?? '');
    if (!message.trim()) {
        throw new Error('Missing message param');
    }

    const loadedConfig = (dependencies.loadConfig ?? configManager.load)({ cwd: baseCwd });
    const { config } = resolveConfigWithEnvOverrides(loadedConfig);
    const sandbox = config.sandbox ?? { mode: 'project', allowedPaths: [] };
    const agentConfig = buildAgentConfigFromXQoderConfig(config, {
        cwd: baseCwd,
        projectRoot: baseCwd,
        promptAppendix: buildChatSystemPrompt(sandbox),
    });

    const kernel = new RuntimeKernel({
        sessionStore: new InMemorySessionStore(),
        permissionPolicy: {
            evaluate: async () => 'allow' as const,
        },
    });

    let pendingAgentConfig: AgentConfig | null = null;
    await loadBuiltInRuntimePlugins(kernel, {
        resolveAgentConfig: async () => {
            if (!pendingAgentConfig) {
                throw new Error('No pending agent configuration');
            }
            return pendingAgentConfig;
        },
        ...(dependencies.createAgent ? { createAgent: dependencies.createAgent } : {}),
    });
    pendingAgentConfig = {
        ...agentConfig,
        cwd: baseCwd,
        projectRoot: baseCwd,
    };

    let response = '';
    let sawAssistantDelta = false;
    let runtimeError: Error | null = null;
    const emitToken = dependencies.emitToken ?? (() => {});

    for await (const event of kernel.runAgent('xqoder-agent', {
        prompt: message,
        messages: [],
    }, {
        sessionId: `acp-chat-${Date.now()}`,
        cwd: baseCwd,
        permissionPolicy: {
            evaluate: async () => 'allow' as const,
        },
    })) {
        if (event.type === 'message.delta' && event.role === 'assistant') {
            sawAssistantDelta = true;
            response += event.text;
            emitToken(event.text);
        }
        if (event.type === 'message.completed' && event.message.role === 'assistant' && !sawAssistantDelta) {
            response = event.message.content;
        }
        if (event.type === 'error') {
            runtimeError = new Error(event.message);
        }
    }

    if (runtimeError) {
        throw runtimeError;
    }

    return { type: 'complete', content: response };
}

/** 从 ACP ContentBlock[] 提取纯文本（仅支持 type: "text"） */
function contentBlocksToPrompt(blocks: unknown[]): string {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    const parts: string[] = [];
    for (const block of blocks) {
        if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
            const text = (block as { text?: string }).text;
            if (typeof text === 'string') parts.push(text);
        }
    }
    return parts.join('\n').trim();
}

function isPermissionMode(value: unknown): value is AgentPermissionMode {
    return typeof value === 'string' && VALID_PERMISSION_MODES.includes(value as AgentPermissionMode);
}

function normalizePermissionSettings(input: unknown, fallback: PermissionSettings): PermissionSettings {
    if (!input || typeof input !== 'object') {
        return fallback;
    }
    const payload = input as PermissionSettings;
    const next: PermissionSettings = {
        defaultMode: isPermissionMode(payload.defaultMode) ? payload.defaultMode : (fallback.defaultMode ?? 'ask'),
        tools: { ...(fallback.tools ?? {}) },
    };

    if (payload.tools && typeof payload.tools === 'object') {
        for (const [key, mode] of Object.entries(payload.tools)) {
            if (isPermissionMode(mode)) {
                next.tools![key] = mode;
            }
        }
    }

    return next;
}

export const acpCommand = new Command('acp')
    .description('启动 ACP (Agent Client Protocol) 服务，通过 stdin/stdout 使用 nd-JSON')
    .option('--cwd <dir>', '工作目录', '.')
    .action(async (opts: { cwd: string }) => {
        const baseCwd = path.resolve(opts.cwd);

        const rl = readline.createInterface({
            input: process.stdin,
            terminal: false,
        });

        // 向后兼容：启动时发送一条 init 能力（可选，部分客户端依赖）
        sendResponse({
            id: 'init',
            result: {
                version: '1.0',
                capabilities: ['chat', 'tools'],
                protocolVersion: 1,
                agentCapabilities: {
                    loadSession: true,
                    sessionCapabilities: { list: {} },
                    permissionCapabilities: { get: true, set: true },
                    mcpCapabilities: { list: true },
                    slashCommandCapabilities: { list: true },
                },
            },
        });

        rl.on('line', async (line) => {
            let request: AcpRequest;
            try {
                request = JSON.parse(line) as AcpRequest;
            } catch {
                sendResponse({
                    id: undefined,
                    error: { code: -32700, message: 'Parse error' },
                });
                return;
            }

            const id = request.id;

            try {
                switch (request.method) {
                    case 'initialize': {
                        sendResponse({
                            id,
                            result: {
                                protocolVersion: 1,
                                agentCapabilities: {
                                    loadSession: true,
                                    sessionCapabilities: { list: {} },
                                    permissionCapabilities: { get: true, set: true },
                                    mcpCapabilities: { http: false, sse: false, list: true },
                                    slashCommandCapabilities: { list: true },
                                    promptCapabilities: { image: false, audio: false, embeddedContext: false },
                                },
                                implementation: { name: 'xqoder', version: '0.2.0' },
                            },
                        });
                        break;
                    }

                    case 'session/new': {
                        sendResponse({
                            id,
                            result: await runAcpSessionNew(request.params, baseCwd),
                        });
                        break;
                    }

                    case 'session/list': {
                        sendResponse({
                            id,
                            result: await runAcpSessionList(request.params, baseCwd),
                        });
                        break;
                    }

                    case 'session/load': {
                        const sessionId = request.params?.sessionId as string;
                        const cwd = (request.params?.cwd as string) || baseCwd;
                        const includeTools = request.params?.includeTools === true;
                        const resolvedCwd = path.resolve(cwd);
                        if (!sessionId) {
                            sendResponse({ id, error: { code: -32602, message: 'Missing sessionId' } });
                            break;
                        }
                        const store = new SQLiteSessionStore(getSessionDbPath(resolvedCwd));
                        const session = await resolveSessionForReuse(store, {
                            projectRoot: resolvedCwd,
                            sessionId,
                            newSession: false,
                        });
                        if (!session) {
                            store.close();
                            sendResponse({ id, error: { code: -32602, message: `Session not found: ${sessionId}` } });
                            break;
                        }
                        const messages = session.getMessages();
                        const compactSummary = session.getCompactSummary();
                        store.close();

                        if (compactSummary) {
                            sendNotification({
                                method: 'session/update',
                                params: {
                                    sessionId,
                                    update: {
                                        sessionUpdate: 'agent_message_chunk',
                                        content: { type: 'text', text: `[session summary]\n${compactSummary}` },
                                    },
                                },
                            });
                        }

                        for (const msg of messages) {
                            if (msg.role === 'system') continue;
                            if (msg.role === 'tool' && !includeTools) continue;
                            const kind = msg.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk';
                            const text = msg.role === 'tool'
                                ? `[tool:${msg.toolCallId ?? 'unknown'}] ${typeof msg.content === 'string' ? msg.content : ''}`
                                : (typeof msg.content === 'string' ? msg.content : '');
                            sendNotification({
                                method: 'session/update',
                                params: {
                                    sessionId,
                                    update: {
                                        sessionUpdate: kind,
                                        content: { type: 'text', text },
                                    },
                                },
                            });
                        }
                        sendResponse({ id, result: null });
                        break;
                    }

                    case 'session/prompt': {
                        try {
                            const result = await runAcpSessionPrompt(request.params, baseCwd, {
                                emitUpdate: sendNotification,
                            });
                            sendResponse({ id, result });
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            const code = message.startsWith('Missing sessionId or content')
                                || message.startsWith('Empty prompt content')
                                || message.startsWith('Session not found:')
                                ? -32602
                                : -32000;
                            sendResponse({ id, error: { code, message } });
                        }
                        break;
                    }

                    case 'agents/list': {
                        const agents = listBuiltInAgents().map((a) => ({
                            name: a.name,
                            description: a.description,
                            mode: a.mode,
                        }));
                        sendResponse({ id, result: { agents } });
                        break;
                    }

                    case 'permissions/get': {
                        const cwd = (request.params?.cwd as string) || baseCwd;
                        const resolvedCwd = path.resolve(cwd);
                        const loaded = configManager.load({ cwd: resolvedCwd });
                        const { config } = resolveConfigWithEnvOverrides(loaded);
                        sendResponse({
                            id,
                            result: {
                                permissions: {
                                    defaultMode: config.permissions?.defaultMode ?? 'ask',
                                    tools: config.permissions?.tools ?? {},
                                },
                            },
                        });
                        break;
                    }

                    case 'permissions/set': {
                        const cwd = (request.params?.cwd as string) || baseCwd;
                        const resolvedCwd = path.resolve(cwd);
                        const loaded = configManager.load({ cwd: resolvedCwd });
                        const { config } = resolveConfigWithEnvOverrides(loaded);
                        const nextPermissions = normalizePermissionSettings(
                            request.params?.permissions,
                            {
                                defaultMode: config.permissions?.defaultMode ?? 'ask',
                                tools: config.permissions?.tools ?? {},
                            },
                        );
                        configManager.update({ permissions: nextPermissions });
                        configManager.save();
                        sendResponse({
                            id,
                            result: {
                                permissions: nextPermissions,
                            },
                        });
                        break;
                    }

                    case 'mcp/list': {
                        const cwd = (request.params?.cwd as string) || baseCwd;
                        const resolvedCwd = path.resolve(cwd);
                        const loaded = configManager.load({ cwd: resolvedCwd });
                        const { config } = resolveConfigWithEnvOverrides(loaded);
                        const servers = (config.mcp?.servers ?? []).map((server) => ({
                            name: server.name,
                            command: server.command,
                            args: server.args ?? [],
                            enabled: server.enabled !== false,
                            cwd: server.cwd,
                            timeoutMs: server.timeoutMs,
                        }));
                        sendResponse({ id, result: { servers } });
                        break;
                    }

                    case 'slash/list': {
                        sendResponse({
                            id,
                            result: {
                                commands: ACP_SLASH_COMMANDS,
                            },
                        });
                        break;
                    }

                    // 兼容旧版单轮 chat（无 session）
                    case 'chat': {
                        try {
                            const result = await runAcpChat(request.params, baseCwd, {
                                emitToken: (token) => {
                                    process.stdout.write(JSON.stringify({
                                        id,
                                        result: { type: 'token', content: token },
                                    }) + '\n');
                                },
                            });
                            sendResponse({ id, result });
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            const code = message.startsWith('Missing message param') ? -32602 : -32000;
                            sendResponse({ id, error: { code, message } });
                        }
                        break;
                    }

                    case 'reset': {
                        sendResponse({ id, result: { status: 'ok' } });
                        break;
                    }

                    case 'ping': {
                        sendResponse({ id, result: { status: 'pong' } });
                        break;
                    }

                    case 'shutdown': {
                        sendResponse({ id, result: { status: 'ok' } });
                        process.exit(0);
                        break;
                    }

                    default:
                        sendResponse({
                            id,
                            error: { code: -32601, message: `Unknown method: ${request.method}` },
                        });
                }
            } catch (err) {
                sendResponse({
                    id,
                    error: {
                        code: -32000,
                        message: err instanceof Error ? err.message : String(err),
                    },
                });
            }
        });

        rl.on('close', async () => {
            process.exit(0);
        });

        logger.info('ACP 服务已启动，等待 stdin 请求...');
    });
