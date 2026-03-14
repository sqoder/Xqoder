// ============================================================
// TUI Agent Service — RuntimeKernel + AgentProvider bridge
// ============================================================

import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    getXQoderPaths,
    globalEventBus,
    createDebugLogger,
    type PermissionSettings,
    type AgentPermissionMode,
    type LLMMessage,
    type MessageAttachment as SharedMessageAttachment,
    type SandboxMode,
} from '@xqoder/shared';
import { AgentSession, TitleAgent, SummarizerAgent, XQoderAgent, buildAgentConfigFromXQoderConfig, type AgentConfig } from '@xqoder/agent';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import { RuntimeKernel } from '@xqoder/core-runtime';
import { createRuntimeSessionStoreAdapter, type AgentSessionStore } from '@xqoder/storage-sqlite';
import type { AppEvent, CoreMessage, MessageAttachment as ProtocolMessageAttachment } from '@xqoder/protocol';
import { loadBuiltInRuntimePlugins } from './runtime-plugin-loader.js';

export interface ToolApprovalPrompt {
    toolCallId: string;
    toolName: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: 'low' | 'medium' | 'high';
}

export interface LegacyAgentTokenEvent { type: 'token'; content: string; }
export interface LegacyAgentToolStartEvent { type: 'tool_start'; name: string; args: Record<string, unknown>; }
export interface LegacyAgentToolEndEvent { type: 'tool_end'; name: string; result: string; success: boolean; }
export interface LegacyAgentToolStreamEvent { type: 'tool_stream'; name: string; chunk: string; stream: 'stdout' | 'stderr'; }
export interface LegacyAgentCompleteEvent { type: 'complete'; response: string; sessionId: string; }
export interface LegacyAgentErrorEvent { type: 'error'; error: Error; }
export type AgentEvent =
    | AppEvent
    | LegacyAgentTokenEvent
    | LegacyAgentToolStartEvent
    | LegacyAgentToolEndEvent
    | LegacyAgentToolStreamEvent
    | LegacyAgentCompleteEvent
    | LegacyAgentErrorEvent;

export interface TuiAgentSettings {
    dir: string;
    model: string;
    agent: string;
    sandboxMode: SandboxMode;
}

export interface SendMessageResult {
    sessionId: string;
    sessionTitle?: string;
}

export interface SendMessageCallbacks {
    onEvent: (event: AppEvent) => void;
    onToolApproval?: (request: ToolApprovalPrompt) => Promise<boolean>;
    onQuestion?: (request: QuestionPrompt) => Promise<QuestionAnswer>;
}

const TOOL_TO_PERMISSION_KEY: Record<string, string> = {
    read_file: 'read',
    write_file: 'edit',
    preview_diff: 'edit',
    apply_patch: 'edit',
    restore_rollback_point: 'edit',
    run_command: 'bash',
    install_package: 'bash',
    grep_content: 'grep',
    search_code: 'grep',
    glob_files: 'glob',
    list_files: 'list',
    fetch_url: 'webfetch',
    websearch: 'websearch',
    delegate_task: 'task',
    diagnostics: 'read',
    sourcegraph: 'read',
    skill: 'skill',
    todowrite: 'todowrite',
    todoread: 'todoread',
    question: 'question',
};

export function resolveRemoteToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
): AgentPermissionMode {
    if (!permissions) {
        return 'ask';
    }
    const key = toolName.startsWith('lsp_')
        ? 'lsp'
        : (TOOL_TO_PERMISSION_KEY[toolName] ?? toolName);
    const mode = permissions.tools?.[key] ?? permissions.defaultMode ?? 'ask';
    return mode === 'allow' || mode === 'ask' || mode === 'deny' ? mode : 'ask';
}

function toProtocolAttachment(attachment: SharedMessageAttachment): ProtocolMessageAttachment {
    return {
        kind: attachment.type,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
    };
}

function toCoreMessage(message: LLMMessage, sessionId: string, index: number): CoreMessage {
    return {
        id: `${sessionId}:history:${index}`,
        sessionId,
        role: message.role,
        content: message.content,
        createdAt: Date.now(),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.attachments && message.attachments.length > 0
            ? { attachments: message.attachments.map(toProtocolAttachment) }
            : {}),
    };
}

export class TuiAgentService {
    private busy = false;
    private debugLogger;
    private currentAgent: XQoderAgent | null = null;
    private pendingAgentConfig: AgentConfig | null = null;
    private readonly runtime: RuntimeKernel;
    private readonly runtimeReady: Promise<void>;

    onTitleGenerated?: (sessionId: string, title: string) => void;

    constructor(private readonly sessionStore: AgentSessionStore) {
        const paths = getXQoderPaths();
        this.debugLogger = process.env['XQODER_DEV_DEBUG']
            ? createDebugLogger(path.join(paths.dataDir, 'debug-logs'))
            : null;

        this.runtime = new RuntimeKernel({
            sessionStore: createRuntimeSessionStoreAdapter(this.sessionStore),
            permissionPolicy: {
                evaluate: async () => 'ask' as const,
            },
        });

        this.runtimeReady = loadBuiltInRuntimePlugins(this.runtime, {
            resolveAgentConfig: async () => {
                if (!this.pendingAgentConfig) {
                    throw new Error('No pending agent configuration');
                }
                return this.pendingAgentConfig;
            },
            createAgent: (config) => {
                const agent = new XQoderAgent(config);
                this.currentAgent = agent;
                return agent;
            },
        });
    }

    get isBusy(): boolean {
        return this.busy;
    }

    cancel(): void {
        this.currentAgent?.cancel();
    }

    async compactSession(sessionId: string, settings: TuiAgentSettings): Promise<string | null> {
        if (this.busy) return null;

        try {
            const session = this.sessionStore.getSession(sessionId);
            if (!session) return null;

            const resolvedDir = path.resolve(settings.dir);
            const loadedConfig = configManager.load({ cwd: resolvedDir });
            const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);
            const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
                agentName: settings.agent,
                cwd: resolvedDir,
                projectRoot: resolvedDir,
                modelOverride: settings.model,
                promptAppendix: [
                    '权限执行规则：',
                    '- 用户明确要求项目外路径（如桌面）时，必须直接按目标路径尝试',
                    '- 不要回复“无法访问系统路径”然后给替代脚本',
                    '- 让工具触发权限审批弹窗，由用户决定允许一次/全会话/拒绝',
                ].join('\n'),
                session,
            });

            const messages = session.getMessages().filter((message) => message.role !== 'system');
            if (messages.length < 4) return null;

            const summarizer = new SummarizerAgent(agentConfig.llmConfig);
            const summary = await summarizer.summarize(messages);
            if (!summary?.trim()) return null;

            session.performCompaction(summary);
            this.sessionStore.saveSession({
                session,
                projectRoot: resolvedDir,
                cwd: resolvedDir,
                model: agentConfig.llmConfig.model,
            });

            return summary;
        } catch {
            return null;
        }
    }

    async sendMessage(
        message: string,
        sessionId: string | undefined,
        settings: TuiAgentSettings,
        attachments: SharedMessageAttachment[] = [],
        callbacks: SendMessageCallbacks,
    ): Promise<SendMessageResult> {
        if (this.busy) {
            throw new Error('Agent is busy');
        }

        await this.runtimeReady;
        this.busy = true;

        let session: AgentSession | undefined;

        try {
            const resolvedDir = path.resolve(settings.dir);
            const loadedConfig = configManager.load({ cwd: resolvedDir });
            const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

            session = sessionId ? this.sessionStore.getSession(sessionId) ?? undefined : undefined;

            const baseAgentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
                agentName: settings.agent,
                cwd: resolvedDir,
                projectRoot: resolvedDir,
                modelOverride: settings.model,
                session,
            });

            const activeSession = session ?? new AgentSession({
                systemPrompt: baseAgentConfig.systemPrompt,
            });

            const agentConfig: AgentConfig = {
                ...baseAgentConfig,
                cwd: resolvedDir,
                projectRoot: resolvedDir,
                session: activeSession,
            };

            this.pendingAgentConfig = agentConfig;
            this.currentAgent = null;

            try {
                this.debugLogger?.logRequest([{
                    role: 'user',
                    content: message,
                    ...(attachments.length > 0
                        ? {
                            attachments: attachments.map((attachment) => ({
                                ...attachment,
                                ...(attachment.data ? { data: `[attachment omitted, ${attachment.data.length} chars]` } : {}),
                            })),
                        }
                        : {}),
                }]);
            } catch {
                // ignore debug logging failures
            }

            let lastAssistantResponse = '';
            let lastError: Error | null = null;
            const emit = (event: AppEvent): void => {
                callbacks.onEvent(event);
                if (event.type === 'tool.called') {
                    try {
                        globalEventBus.emit('tool:start', {
                            toolName: event.tool,
                            args: typeof event.args === 'object' && event.args && !Array.isArray(event.args)
                                ? event.args as Record<string, unknown>
                                : {},
                        });
                    } catch { /* ignore */ }
                }
                if (event.type === 'tool.completed') {
                    try { globalEventBus.emit('tool:end', { toolName: event.tool, success: event.success }); } catch { /* ignore */ }
                }
                if (event.type === 'message.completed' && event.message.role === 'assistant') {
                    lastAssistantResponse = event.message.content;
                }
                if (event.type === 'error') {
                    lastError = new Error(event.message);
                }
            };

            const runtimeDescriptor = {
                sessionId: activeSession.id,
                cwd: resolvedDir,
                permissionPolicy: {
                    evaluate: async (request: { target?: string }) => {
                        const target = typeof request.target === 'string' ? request.target : '';
                        const mode = resolveRemoteToolPermissionMode(target, effectiveConfig.permissions);
                        if (mode === 'ask' && !callbacks.onToolApproval) {
                            return 'deny' as const;
                        }
                        return mode;
                    },
                },
                requestToolApproval: callbacks.onToolApproval
                    ? async (request: ToolApprovalPrompt) => (await callbacks.onToolApproval?.(request)) ? 'allow' : 'deny'
                    : undefined,
                requestQuestion: callbacks.onQuestion
                    ? async (request: QuestionPrompt) => (await callbacks.onQuestion?.(request)) ?? {
                        requestId: request.requestId,
                        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
                    }
                    : async (request: QuestionPrompt) => ({
                        requestId: request.requestId,
                        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
                    }),
            };

            for await (const event of this.runtime.runAgent('xqoder-agent', {
                prompt: message,
                messages: activeSession.getMessages().map((entry, index) => toCoreMessage(entry, activeSession.id, index)),
                attachments: attachments.map(toProtocolAttachment),
            }, runtimeDescriptor)) {
                emit(event);
            }

            if (lastError) {
                throw lastError;
            }

            try {
                this.debugLogger?.logResponse({ response: lastAssistantResponse });
            } catch {
                // ignore debug logging failures
            }

            const savedSummary = this.sessionStore.saveSession({
                session: activeSession,
                projectRoot: resolvedDir,
                cwd: resolvedDir,
                model: agentConfig.llmConfig.model,
            });

            if (savedSummary.title === savedSummary.lastUserMessage?.slice(0, 50) || !savedSummary.title) {
                const sid = savedSummary.id;
                const userMsg = message;
                void (async () => {
                    try {
                        const titleAgent = new TitleAgent(agentConfig.llmConfig);
                        const generatedTitle = await titleAgent.generateTitle(userMsg);
                        if (generatedTitle) {
                            try {
                                this.sessionStore.updateSessionTitle(sid, generatedTitle);
                            } catch {
                                // title persistence is best-effort
                            }
                            this.onTitleGenerated?.(sid, generatedTitle);
                        }
                    } catch {
                        // title generation is best-effort
                    }
                })();
            }

            return {
                sessionId: savedSummary.id,
                sessionTitle: savedSummary.title,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            callbacks.onEvent({
                type: 'error',
                sessionId: session?.id ?? sessionId ?? 'unknown-session',
                timestamp: Date.now(),
                source: 'runtime',
                message: err.message,
                recoverable: false,
            });
            throw err;
        } finally {
            this.currentAgent = null;
            this.pendingAgentConfig = null;
            this.busy = false;
        }
    }

    async dispose(): Promise<void> {
        await this.currentAgent?.dispose();
        this.currentAgent = null;
    }
}

/** 通过 HTTP 调用远程 serve 的 Agent 服务（attach 模式） */
export class RemoteTuiAgentService {
    private busy = false;
    private activeAbortController: AbortController | null = null;
    private activeStreamMeta: { sessionId: string; streamId: string } | null = null;

    constructor(
        private readonly baseUrl: string,
        private readonly auth?: { username: string; password: string },
    ) {}

    private async fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
        const url = path.startsWith('http') ? path : `${this.baseUrl.replace(/\/$/, '')}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string>),
        };
        if (this.auth) {
            headers['Authorization'] = 'Basic ' + Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
        }
        const res = await fetch(url, { ...init, headers });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`API ${res.status}: ${text || res.statusText}`);
        }
        return res.json() as Promise<T>;
    }

    private buildHeaders(init?: RequestInit): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string>),
        };
        if (this.auth) {
            headers['Authorization'] = 'Basic ' + Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
        }
        return headers;
    }

    private async postQuestionResolve(
        sessionId: string,
        requestId: string,
        answer: { selected: string[]; customText?: string; streamId?: string },
    ): Promise<void> {
        await this.fetchApi<{ ok: boolean }>(
            `/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestId)}/resolve`,
            {
                method: 'POST',
                body: JSON.stringify(answer),
            },
        );
    }

    private async postStreamCancel(sessionId: string, streamId: string): Promise<void> {
        await this.fetchApi<{ ok: boolean }>(
            `/session/${encodeURIComponent(sessionId)}/stream/${encodeURIComponent(streamId)}/cancel`,
            {
                method: 'POST',
                body: JSON.stringify({}),
            },
        );
    }

    cancel(): void {
        this.activeAbortController?.abort(new Error('Cancelled by user'));
        if (this.activeStreamMeta) {
            void this.postStreamCancel(this.activeStreamMeta.sessionId, this.activeStreamMeta.streamId).catch(() => {
                // ignore cancel propagation failures
            });
        }
    }

    /** 列出 session，用于 attach 时解析「当前 session」与 /session list */
    async listSessions(projectRoot: string, limit = 20): Promise<Array<{ id: string; title: string; updatedAt: string; messageCount?: number }>> {
        const list = await this.fetchApi<Array<{ id: string; title: string; updatedAt: string; messageCount?: number }>>(
            `/session?projectRoot=${encodeURIComponent(projectRoot)}&limit=${limit}`,
        );
        return Array.isArray(list) ? list : [];
    }

    /** 拉取会话历史，用于 attach 下 /session switch 后恢复 transcript */
    async getSessionMessages(sessionId: string): Promise<{ messages: import('@xqoder/shared').LLMMessage[] }> {
        const data = await this.fetchApi<{ messages: import('@xqoder/shared').LLMMessage[] }>(
            `/session/${encodeURIComponent(sessionId)}/messages`,
        );
        return { messages: Array.isArray(data?.messages) ? data.messages : [] };
    }

    /** 新建 session（attach 下 /session new） */
    async createSession(projectRoot: string, title?: string): Promise<{ id: string; title: string }> {
        const created = await this.fetchApi<{ id: string; title?: string }>('/session', {
            method: 'POST',
            body: JSON.stringify({ projectRoot: path.resolve(projectRoot), title: title ?? 'New Session' }),
        });
        return { id: created.id, title: created.title ?? 'New Session' };
    }

    async sendMessage(
        message: string,
        sessionId: string | undefined,
        settings: TuiAgentSettings,
        attachments: SharedMessageAttachment[] = [],
        callbacks: SendMessageCallbacks,
    ): Promise<SendMessageResult> {
        if (this.busy) throw new Error('Agent is busy');
        this.busy = true;
        this.activeAbortController = null;
        this.activeStreamMeta = null;

        const resolvedDir = path.resolve(settings.dir);
        let activeId = sessionId;

        try {
            if (!activeId) {
                const list = await this.listSessions(resolvedDir, 1);
                if (list.length > 0) {
                    activeId = list[0].id;
                } else {
                    const created = await this.fetchApi<{ id: string }>('/session', {
                        method: 'POST',
                        body: JSON.stringify({ projectRoot: resolvedDir, title: 'New Session' }),
                    });
                    activeId = created.id;
                }
            }

            const userMsgId = `remote:user:${Date.now()}`;
            callbacks.onEvent({
                type: 'message.started',
                sessionId: activeId,
                timestamp: Date.now(),
                source: 'agent',
                message: { id: userMsgId, sessionId: activeId, role: 'user', content: message, createdAt: Date.now() },
            });
            callbacks.onEvent({
                type: 'message.completed',
                sessionId: activeId,
                timestamp: Date.now(),
                source: 'agent',
                message: { id: userMsgId, sessionId: activeId, role: 'user', content: message, createdAt: Date.now() },
            });

            const body = {
                message,
                attachments: attachments.length > 0 ? attachments.map((a) => ({ type: a.type, mimeType: a.mimeType, data: a.data, filePath: a.filePath, fileName: a.fileName })) : undefined,
            };
            let resolvedSessionId = activeId;
            const streamUrl = `${this.baseUrl.replace(/\/$/, '')}/session/${encodeURIComponent(activeId)}/message/stream`;
            const timeoutMs = 45000;
            let reconnectAttempts = 0;
            let streamId: string | undefined;
            let cursor = 0;
            let completed = false;

            while (!completed) {
                const attemptBody = streamId
                    ? { streamId, cursor, timeoutMs }
                    : { ...body, timeoutMs };

                const controller = new AbortController();
                this.activeAbortController = controller;
                const timer = setTimeout(() => {
                    controller.abort(new Error(`Stream request timed out (${timeoutMs}ms)`));
                }, timeoutMs);
                timer.unref?.();

                let streamRes: Response;
                try {
                    streamRes = await fetch(streamUrl, {
                        method: 'POST',
                        headers: this.buildHeaders(),
                        body: JSON.stringify(attemptBody),
                        signal: controller.signal,
                    });
                } catch (err) {
                    clearTimeout(timer);
                    if (reconnectAttempts >= 3 || !streamId) {
                        throw err instanceof Error ? err : new Error(String(err));
                    }
                    reconnectAttempts += 1;
                    await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 250 * reconnectAttempts)));
                    continue;
                }

                clearTimeout(timer);

                if (!streamRes.ok) {
                    const text = await streamRes.text();
                    throw new Error(`API ${streamRes.status}: ${text || streamRes.statusText}`);
                }

                if (!streamRes.body) {
                    throw new Error('Remote stream response has no body');
                }

                const decoder = new TextDecoder();
                const reader = streamRes.body.getReader();
                let buffer = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break;
                        }
                        buffer += decoder.decode(value, { stream: true });

                        let newline = buffer.indexOf('\n');
                        while (newline !== -1) {
                            const rawLine = buffer.slice(0, newline).trim();
                            buffer = buffer.slice(newline + 1);
                            newline = buffer.indexOf('\n');

                            if (!rawLine) {
                                continue;
                            }

                            const record = JSON.parse(rawLine) as
                                | { type: 'event'; streamId: string; seq: number; cursor: number; event: AppEvent }
                                | { type: 'done'; streamId: string; seq: number; cursor: number; response?: string; sessionId?: string }
                                | { type: 'error'; streamId: string; seq: number; cursor: number; message?: string }
                                | { type: 'cancelled'; streamId: string; seq: number; cursor: number; reason?: string };

                            if ('streamId' in record && !streamId) {
                                streamId = record.streamId;
                                this.activeStreamMeta = { sessionId: activeId, streamId };
                            }
                            if ('seq' in record && Number.isFinite(record.seq)) {
                                cursor = Math.max(cursor, record.seq);
                            }

                            if (record.type === 'event') {
                                callbacks.onEvent(record.event);

                                if (record.event.type === 'question.requested') {
                                    const answer = callbacks.onQuestion
                                        ? await callbacks.onQuestion({
                                            requestId: record.event.requestId,
                                            question: record.event.question,
                                            header: record.event.header,
                                            options: record.event.options,
                                            multiple: record.event.multiple,
                                            allowCustom: record.event.allowCustom,
                                        })
                                        : {
                                            requestId: record.event.requestId,
                                            selected: record.event.options.length > 0 ? [record.event.options[0]!.label] : [],
                                        };

                                    await this.postQuestionResolve(activeId, record.event.requestId, {
                                        selected: answer.selected,
                                        ...(answer.customText ? { customText: answer.customText } : {}),
                                        ...(streamId ? { streamId } : {}),
                                    });
                                }
                                continue;
                            }

                            if (record.type === 'done') {
                                if (record.sessionId) {
                                    resolvedSessionId = record.sessionId;
                                }
                                completed = true;
                                continue;
                            }

                            if (record.type === 'cancelled') {
                                throw new Error(record.reason ?? 'Remote stream cancelled');
                            }

                            if (record.type === 'error') {
                                throw new Error(record.message ?? 'Remote message stream failed');
                            }
                        }
                    }
                } catch (err) {
                    if (completed) {
                        break;
                    }
                    if (reconnectAttempts >= 3 || !streamId) {
                        throw err instanceof Error ? err : new Error(String(err));
                    }
                    reconnectAttempts += 1;
                    await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 250 * reconnectAttempts)));
                    continue;
                }

                const trailing = buffer.trim();
                if (trailing) {
                    const record = JSON.parse(trailing) as
                        | { type: 'event'; streamId: string; seq: number; cursor: number; event: AppEvent }
                        | { type: 'done'; streamId: string; seq: number; cursor: number; response?: string; sessionId?: string }
                        | { type: 'error'; streamId: string; seq: number; cursor: number; message?: string }
                        | { type: 'cancelled'; streamId: string; seq: number; cursor: number; reason?: string };
                    if ('streamId' in record && !streamId) {
                        streamId = record.streamId;
                        this.activeStreamMeta = { sessionId: activeId, streamId };
                    }
                    if ('seq' in record && Number.isFinite(record.seq)) {
                        cursor = Math.max(cursor, record.seq);
                    }
                    if (record.type === 'event') {
                        callbacks.onEvent(record.event);
                    } else if (record.type === 'done') {
                        if (record.sessionId) {
                            resolvedSessionId = record.sessionId;
                        }
                        completed = true;
                    } else if (record.type === 'cancelled') {
                        throw new Error(record.reason ?? 'Remote stream cancelled');
                    } else if (record.type === 'error') {
                        throw new Error(record.message ?? 'Remote message stream failed');
                    }
                }

                if (!completed && streamId) {
                    reconnectAttempts += 1;
                    if (reconnectAttempts > 3) {
                        throw new Error('Remote stream ended unexpectedly without completion');
                    }
                }
            }

            return { sessionId: resolvedSessionId };
        } finally {
            this.activeAbortController = null;
            this.activeStreamMeta = null;
            this.busy = false;
        }
    }

    async dispose(): Promise<void> {}
}
