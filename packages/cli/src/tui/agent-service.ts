// ============================================================
// TUI Agent Service — RuntimeKernel + AgentProvider bridge
// ============================================================

import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import {
    getXQoderPaths,
    createDebugLogger,
    type DebugLogger,
    type LLMMessage,
    type MessageAttachment as SharedMessageAttachment,
    type SandboxMode,
} from '@xqoder/shared';
import {
    AgentSession,
    XQoderAgent,
    type AgentConfig,
    type AgentCallbacks,
    type AgentSessionSnapshot,
    type RuntimeAgentSessionStore,
    type XQoderAgentProviderOptions,
} from '@xqoder/agent';
import type { QuestionAnswer, QuestionPrompt } from '@xqoder/plugin-sdk';
import { RuntimeKernel } from '@xqoder/runtime';
import { createRuntimeSessionStoreAdapter } from '@xqoder/storage-sqlite';
import type { AppEvent } from '@xqoder/protocol';
import { createRuntimeSessionBackingStore } from '../services/runtime-session-backing-store.js';
import { loadBuiltInRuntimePlugins } from './runtime-plugin-loader.js';
import {
    compactRuntimeSession,
    loadSessionFromRuntime as loadRuntimeSession,
    persistCrashRecoverySnapshot as persistAgentCrashRecoverySnapshot,
    persistRuntimeSessionSnapshot,
    replaceRuntimeSessionMessages,
    type CrashRecoveryCheckpoint,
} from './agent-service-session-runtime.js';
import {
    createLocalRuntimeDescriptor,
    finalizeLocalRuntimeRun,
    isPlanReadOnlyTool,
    logLocalAgentRequest,
    logLocalAgentResponse,
    prepareLocalAgentRun,
    resolveRemoteToolPermissionMode,
    runLocalRuntimeAgent,
} from './agent-service-local-run.js';
import {
    emitRemoteUserMessage,
    runRemoteMessageStream,
} from './agent-service-remote-stream.js';

export type LocalTuiSessionStore = RuntimeAgentSessionStore;

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

type CrashSafeAgentLike =
    ReturnType<NonNullable<XQoderAgentProviderOptions['createAgent']>>
    & Partial<Pick<XQoderAgent, 'cancel' | 'dispose'>>
    & {
        getSessionSnapshot?: () => AgentSessionSnapshot;
        run: (userMessage: string, callbacks?: AgentCallbacks, attachments?: SharedMessageAttachment[]) => Promise<string>;
    };

interface TuiAgentServiceOptions {
    createAgent?: (config: AgentConfig) => CrashSafeAgentLike;
}

export { isPlanReadOnlyTool, resolveRemoteToolPermissionMode } from './agent-service-local-run.js';

export class TuiAgentService {
    private busy = false;
    private debugLogger: DebugLogger | null;
    private currentAgent: CrashSafeAgentLike | null = null;
    private pendingAgentConfig: AgentConfig | null = null;
    private activeCrashCheckpoint: CrashRecoveryCheckpoint | null = null;
    private readonly runtime: RuntimeKernel;
    private readonly runtimeReady: Promise<void>;

    onTitleGenerated?: (sessionId: string, title: string) => void;

    constructor(
        private readonly sessionStore: LocalTuiSessionStore,
        options: TuiAgentServiceOptions = {},
    ) {
        const paths = getXQoderPaths();
        this.debugLogger = process.env['XQODER_DEV_DEBUG']
            ? createDebugLogger(path.join(paths.dataDir, 'debug-logs'))
            : null;

        this.runtime = new RuntimeKernel({
            sessionStore: createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(this.sessionStore)),
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
                const agent = options.createAgent?.(config) ?? new XQoderAgent(config);
                this.currentAgent = agent;
                return agent;
            },
        });
    }

    get isBusy(): boolean {
        return this.busy;
    }

    cancel(): void {
        this.currentAgent?.cancel?.();
    }

    private persistCrashRecoverySnapshot(): void {
        persistAgentCrashRecoverySnapshot(
            this.sessionStore,
            this.activeCrashCheckpoint,
            this.currentAgent,
        );
    }

    private async loadSessionFromRuntime(sessionId: string): Promise<AgentSession | undefined> {
        return await loadRuntimeSession(this.runtime, sessionId);
    }

    async persistSessionSnapshot(input: {
        session: AgentSession;
        cwd: string;
        projectRoot: string;
        model: string;
        title?: string;
    }): Promise<void> {
        await persistRuntimeSessionSnapshot(this.runtime, input);
    }

    async replaceSessionMessages(input: {
        sessionId: string;
        cwd: string;
        projectRoot: string;
        model: string;
        title?: string;
        messages: LLMMessage[];
    }): Promise<void> {
        await replaceRuntimeSessionMessages(this.runtime, input);
    }

    async compactSession(sessionId: string, settings: TuiAgentSettings): Promise<string | null> {
        if (this.busy) return null;
        return await compactRuntimeSession(this.runtime, sessionId, settings);
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
            const prepared = await prepareLocalAgentRun({
                sessionId,
                settings: {
                    ...settings,
                    dir: path.resolve(settings.dir),
                },
                resolveExistingSession: async (requestedSessionId) => await this.loadSessionFromRuntime(requestedSessionId),
            });
            session = prepared.loadedSession;

            this.pendingAgentConfig = prepared.agentConfig;
            this.currentAgent = null;
            this.activeCrashCheckpoint = prepared.crashCheckpoint;

            logLocalAgentRequest(this.debugLogger, message, attachments);

            const runtimeDescriptor = createLocalRuntimeDescriptor({
                sessionId: prepared.activeSession.id,
                cwd: prepared.resolvedDir,
                prompt: message,
                permissions: prepared.permissions,
                callbacks,
            });

            const { lastAssistantResponse } = await runLocalRuntimeAgent({
                runtime: this.runtime,
                session: prepared.activeSession,
                prompt: message,
                attachments,
                runtimeDescriptor,
                callbacks,
                persistCrashRecoverySnapshot: () => this.persistCrashRecoverySnapshot(),
            });

            logLocalAgentResponse(this.debugLogger, lastAssistantResponse);

            return await finalizeLocalRuntimeRun({
                runtime: this.runtime,
                sessionId: prepared.activeSession.id,
                cwd: prepared.resolvedDir,
                projectRoot: prepared.resolvedDir,
                model: prepared.agentConfig.llmConfig.model,
                userMessage: message,
                llmConfig: prepared.agentConfig.llmConfig,
                onTitleGenerated: this.onTitleGenerated,
            });
        } catch (error) {
            this.persistCrashRecoverySnapshot();
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
            this.persistCrashRecoverySnapshot();
            this.currentAgent = null;
            this.pendingAgentConfig = null;
            this.activeCrashCheckpoint = null;
            this.busy = false;
        }
    }

    async dispose(): Promise<void> {
        this.persistCrashRecoverySnapshot();
        this.currentAgent?.cancel?.();
        await this.currentAgent?.dispose?.();
        this.currentAgent = null;
        this.activeCrashCheckpoint = null;
    }
}

/** 通过 HTTP 调用远程 serve 的 Agent 服务（attach 模式） */
export class RemoteTuiAgentService {
    private busy = false;
    private activeAbortController: AbortController | null = null;
    private activeStreamMeta: { sessionId: string; streamId: string } | null = null;
    private readonly fetchImpl: typeof fetch;
    private static readonly MAX_RECONNECT_ATTEMPTS = 3;

    constructor(
        private readonly baseUrl: string,
        private readonly auth?: { username: string; password: string },
        options: { fetchImpl?: typeof fetch } = {},
    ) {
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    private async fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
        const url = path.startsWith('http') ? path : `${this.baseUrl.replace(/\/$/, '')}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string>),
        };
        if (this.auth) {
            headers['Authorization'] = 'Basic ' + Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
        }
        const res = await this.fetchImpl(url, { ...init, headers });
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

            emitRemoteUserMessage(callbacks, activeId, message);
            const streamUrl = `${this.baseUrl.replace(/\/$/, '')}/session/${encodeURIComponent(activeId)}/message/stream`;
            const result = await runRemoteMessageStream({
                fetchImpl: this.fetchImpl,
                streamUrl,
                sessionId: activeId,
                message,
                attachments,
                callbacks,
                buildHeaders: () => this.buildHeaders(),
                postQuestionResolve: (sessionId, requestId, answer) => this.postQuestionResolve(sessionId, requestId, answer),
                setActiveAbortController: (controller) => {
                    this.activeAbortController = controller;
                },
                setActiveStreamMeta: (meta) => {
                    this.activeStreamMeta = meta;
                },
                maxReconnectAttempts: RemoteTuiAgentService.MAX_RECONNECT_ATTEMPTS,
            });

            return { sessionId: result.sessionId };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            callbacks.onEvent({
                type: 'error',
                sessionId: activeId ?? 'unknown-session',
                timestamp: Date.now(),
                source: 'runtime',
                message: err.message,
                recoverable: false,
            });
            throw err;
        } finally {
            this.activeAbortController = null;
            this.activeStreamMeta = null;
            this.busy = false;
        }
    }

    async dispose(): Promise<void> {}
}
