// ============================================================
// TUI Agent Service — RuntimeKernel + AgentProvider bridge
// ============================================================

import * as path from 'node:path';
import {
    configManager,
    resolveConfigWithEnvOverrides,
    getXQoderPaths,
    globalEventBus,
    createDebugLogger,
    type LLMMessage,
    type MessageAttachment as SharedMessageAttachment,
    type SandboxMode,
} from '@xqoder/shared';
import { AgentSession, TitleAgent, SummarizerAgent, XQoderAgent, buildAgentConfigFromXQoderConfig, type AgentConfig } from '@xqoder/agent';
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
                    evaluate: async () => 'ask' as const,
                },
                requestToolApproval: callbacks.onToolApproval
                    ? async (request: ToolApprovalPrompt) => (await callbacks.onToolApproval?.(request)) ? 'allow' : 'deny'
                    : async () => 'deny' as const,
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
