import * as path from 'node:path';
import {
    getXQoderPaths,
    createDebugLogger,
    type MessageAttachment as SharedMessageAttachment,
} from '@xqoder/shared';
import {
    XQoderAgent,
    type AgentConfig,
} from '@xqoder/agent';
import { RuntimeKernel } from '@xqoder/core-runtime';
import type { AgentSessionStore } from '@xqoder/storage-sqlite';
import type {
    AgentConversationPort,
    SendMessageCallbacks,
    SendMessageResult,
    TuiAgentSettings,
} from '../../application/agent/index.js';
import {
    compactTuiAgentSession,
    persistTuiAgentSession,
    resolveTuiAgentSendContext,
} from './tui-agent-session-operations.js';
import {
    createTuiAgentRuntime,
    createTuiRuntimeDescriptor,
    createTuiRuntimeEventRelay,
    toCoreMessage,
    toProtocolAttachment,
} from './tui-agent-runtime-support.js';

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

        const runtimeState = createTuiAgentRuntime(this.sessionStore, {
            getPendingAgentConfig: () => this.pendingAgentConfig,
            setCurrentAgent: (agent) => {
                this.currentAgent = agent;
            },
        });
        this.runtime = runtimeState.runtime;
        this.runtimeReady = runtimeState.runtimeReady;
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
            return await compactTuiAgentSession(this.sessionStore, sessionId, settings);
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

        let activeSessionId = sessionId;
        let errorEmitted = false;
        let eventRelay: ReturnType<typeof createTuiRuntimeEventRelay> | null = null;

        try {
            const {
                resolvedDir,
                permissions,
                activeSession,
                agentConfig,
            } = resolveTuiAgentSendContext(this.sessionStore, sessionId, settings);
            activeSessionId = activeSession.id;

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

            eventRelay = createTuiRuntimeEventRelay(callbacks);
            const runtimeDescriptor = createTuiRuntimeDescriptor({
                sessionId: activeSession.id,
                cwd: resolvedDir,
                permissions,
                callbacks,
            });

            for await (const event of this.runtime.runAgent('xqoder-agent', {
                prompt: message,
                messages: activeSession.getMessages().map((entry, index) => toCoreMessage(entry, activeSession.id, index)),
                attachments: attachments.map(toProtocolAttachment),
            }, runtimeDescriptor)) {
                eventRelay.emit(event);
            }

            const eventState = eventRelay.getState();
            errorEmitted = eventState.errorEmitted;

            try {
                this.debugLogger?.logResponse({ response: eventState.lastAssistantResponse });
            } catch {
                // ignore debug logging failures
            }

            return persistTuiAgentSession({
                sessionStore: this.sessionStore,
                activeSession,
                resolvedDir,
                agentConfig,
                userMessage: message,
                onTitleGenerated: this.onTitleGenerated,
            });
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            errorEmitted = errorEmitted || eventRelay?.getState().errorEmitted === true;
            if (!errorEmitted) {
                callbacks.onEvent({
                    type: 'error',
                    sessionId: activeSessionId ?? 'unknown-session',
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
                sessionId: activeSessionId ?? 'unknown-session',
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
