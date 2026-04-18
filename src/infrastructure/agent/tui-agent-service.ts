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
} from '@xqoder/shared';
import {
    AgentSession,
    TitleAgent,
    SummarizerAgent,
    XQoderAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentConfig,
} from '@xqoder/agent';
import { RuntimeKernel } from '@xqoder/core-runtime';
import { createRuntimeSessionStoreAdapter, type AgentSessionStore } from '@xqoder/storage-sqlite';
import type {
    CoreMessage,
    MessageAttachment as ProtocolMessageAttachment,
} from '@xqoder/protocol';
import { loadBuiltInRuntimePlugins } from '../../plugins/runtime-plugin-loader.js';
import {
    resolveToolPermissionMode,
    type ToolApprovalRequest,
} from '../../domain/permissions/index.js';
import { buildProjectNotepadPromptAppendix } from '../../application/system/notepad.js';
import type {
    AgentConversationPort,
    AgentQuestionAnswer,
    AgentQuestionRequest,
    AgentRuntimeEvent,
    RemoteAgentConversationPort,
    SendMessageCallbacks,
    SendMessageResult,
    TuiAgentSettings,
} from '../../application/agent/index.js';

function resolveRemoteToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
): AgentPermissionMode {
    return resolveToolPermissionMode(toolName, permissions);
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

export class TuiAgentService implements AgentConversationPort {
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
                    'Permission execution rules:',
                    '- When the user explicitly requests a path outside the project (e.g., Desktop), you MUST attempt use the target path directly.',
                    '- Do NOT reply "cannot access system path" and offer an alternative script instead.',
                    '- Let the tool trigger the permission approval dialog, allowing the user to decide (allow once / allow full session / deny).',
                    buildProjectNotepadPromptAppendix(resolvedDir),
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
        let errorEmitted = false;

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
                promptAppendix: buildProjectNotepadPromptAppendix(resolvedDir),
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
            const emit = (event: AgentRuntimeEvent): void => {
                if (event.type === 'error') {
                    errorEmitted = true;
                }
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
                    ? async (request: ToolApprovalRequest) => (await callbacks.onToolApproval?.(request)) ? 'allow' : 'deny'
                    : undefined,
                requestQuestion: callbacks.onQuestion
                    ? async (request: AgentQuestionRequest) => (await callbacks.onQuestion?.(request)) ?? {
                        requestId: request.requestId,
                        selected: request.options.length > 0 ? [request.options[0]!.label] : [],
                    }
                    : async (request: AgentQuestionRequest): Promise<AgentQuestionAnswer> => ({
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
            if (!errorEmitted) {
                callbacks.onEvent({
                    type: 'error',
                    sessionId: session?.id ?? sessionId ?? 'unknown-session',
                    timestamp: Date.now(),
                    source: 'runtime',
                    message: err.message,
                    recoverable: false,
                });
            }
            if (!errorEmitted) {
                throw err;
            }
            return {
                sessionId: sessionId ?? 'unknown-session',
            };
        } finally {
            this.currentAgent = null;
            this.pendingAgentConfig = null;
            this.busy = false;
        }
    }

    async dispose(): Promise<void> {
        this.currentAgent?.cancel();
        await this.currentAgent?.dispose();
        this.currentAgent = null;
    }
}

export class RemoteTuiAgentService implements RemoteAgentConversationPort {
    private busy = false;
    private activeAbortController: AbortController | null = null;
    private activeStreamMeta: { sessionId: string; streamId: string } | null = null;

    get isBusy(): boolean {
        return this.busy;
    }

    constructor(
        private readonly baseUrl: string,
        private readonly auth?: { username: string; password: string },
    ) {}

    private async fetchApi<T>(pathValue: string, init?: RequestInit): Promise<T> {
        const url = pathValue.startsWith('http') ? pathValue : `${this.baseUrl.replace(/\/$/, '')}${pathValue}`;
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

    async dispose(): Promise<void> {
        this.cancel();
        this.activeAbortController = null;
        this.activeStreamMeta = null;
    }

    async compactSession(): Promise<string | null> {
        return null;
    }

    async listSessions(projectRoot: string, limit = 20): Promise<Array<{ id: string; title: string; updatedAt: string; messageCount?: number }>> {
        const list = await this.fetchApi<Array<{ id: string; title: string; updatedAt: string; messageCount?: number }>>(
            `/session?projectRoot=${encodeURIComponent(projectRoot)}&limit=${limit}`,
        );
        return Array.isArray(list) ? list : [];
    }

    async getSessionMessages(sessionId: string): Promise<{ messages: import('@xqoder/shared').LLMMessage[] }> {
        const data = await this.fetchApi<{ messages: import('@xqoder/shared').LLMMessage[] }>(
            `/session/${encodeURIComponent(sessionId)}/messages`,
        );
        return { messages: Array.isArray(data?.messages) ? data.messages : [] };
    }

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
                                | { type: 'event'; streamId: string; seq: number; cursor: number; event: AgentRuntimeEvent }
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
                                        selected: answer.selected ?? [],
                                        customText: answer.customText,
                                        streamId,
                                    });
                                }
                                continue;
                            }

                            if (record.type === 'done') {
                                completed = true;
                                resolvedSessionId = record.sessionId ?? resolvedSessionId;
                                break;
                            }

                            if (record.type === 'cancelled') {
                                throw new Error(record.reason ?? 'Stream cancelled');
                            }

                            if (record.type === 'error') {
                                throw new Error(record.message ?? 'Remote stream failed');
                            }
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                if (!completed && streamId) {
                    reconnectAttempts += 1;
                    if (reconnectAttempts > 3) {
                        throw new Error('Remote stream did not complete after multiple reconnect attempts');
                    }
                    await new Promise((resolve) => setTimeout(resolve, Math.min(1500, 250 * reconnectAttempts)));
                }
            }

            return {
                sessionId: resolvedSessionId,
            };
        } finally {
            this.busy = false;
            this.activeAbortController = null;
            this.activeStreamMeta = null;
        }
    }
}
