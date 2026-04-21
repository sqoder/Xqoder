import {
    globalEventBus,
    type PermissionSettings,
    type LLMMessage,
    type MessageAttachment as SharedMessageAttachment,
} from '@xqoder/shared';
import {
    XQoderAgent,
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
import type {
    AgentQuestionAnswer,
    AgentQuestionRequest,
    AgentRuntimeEvent,
    SendMessageCallbacks,
} from '../../application/agent/index.js';

export function resolveRemoteToolPermissionMode(
    toolName: string,
    permissions: PermissionSettings | undefined,
): 'allow' | 'ask' | 'deny' {
    const mode = resolveToolPermissionMode(toolName, permissions);
    if (mode === 'allow' || mode === 'ask' || mode === 'deny') {
        return mode;
    }
    if (mode === 'bypassPermissions') {
        return 'allow';
    }

    return 'ask';
}

export function toProtocolAttachment(attachment: SharedMessageAttachment): ProtocolMessageAttachment {
    return {
        kind: attachment.type,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
    };
}

export function toCoreMessage(message: LLMMessage, sessionId: string, index: number): CoreMessage {
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

export interface TuiAgentRuntimeState {
    getPendingAgentConfig(): AgentConfig | null;
    setCurrentAgent(agent: XQoderAgent | null): void;
}

export function createTuiAgentRuntime(
    sessionStore: AgentSessionStore,
    state: TuiAgentRuntimeState,
): { runtime: RuntimeKernel; runtimeReady: Promise<void> } {
    const runtime = new RuntimeKernel({
        sessionStore: createRuntimeSessionStoreAdapter(sessionStore),
        permissionPolicy: {
            evaluate: async () => 'ask' as const,
        },
    });

    const runtimeReady = loadBuiltInRuntimePlugins(runtime, {
        resolveAgentConfig: async () => {
            const pendingAgentConfig = state.getPendingAgentConfig();
            if (!pendingAgentConfig) {
                throw new Error('No pending agent configuration');
            }
            return pendingAgentConfig;
        },
        createAgent: (config) => {
            const agent = new XQoderAgent(config);
            state.setCurrentAgent(agent);
            return agent;
        },
    });

    return {
        runtime,
        runtimeReady,
    };
}

export interface TuiRuntimeEventRelay {
    emit(event: AgentRuntimeEvent): void;
    getState(): { lastAssistantResponse: string; errorEmitted: boolean };
}

export function createTuiRuntimeEventRelay(
    callbacks: SendMessageCallbacks,
    dependencies: {
        eventBus?: { emit(eventName: string, payload: unknown): void };
    } = {},
): TuiRuntimeEventRelay {
    const eventBus = dependencies.eventBus ?? globalEventBus;
    let lastAssistantResponse = '';
    let errorEmitted = false;

    return {
        emit(event) {
            if (event.type === 'error') {
                errorEmitted = true;
            }

            callbacks.onEvent(event);

            if (event.type === 'tool.called') {
                try {
                    eventBus.emit('tool:start', {
                        toolName: event.tool,
                        args: typeof event.args === 'object' && event.args && !Array.isArray(event.args)
                            ? event.args as Record<string, unknown>
                            : {},
                    });
                } catch {
                    // ignore event bus failures
                }
            }

            if (event.type === 'tool.completed') {
                try {
                    eventBus.emit('tool:end', {
                        toolName: event.tool,
                        success: event.success,
                    });
                } catch {
                    // ignore event bus failures
                }
            }

            if (event.type === 'message.completed' && event.message.role === 'assistant') {
                lastAssistantResponse = event.message.content;
            }
        },
        getState() {
            return {
                lastAssistantResponse,
                errorEmitted,
            };
        },
    };
}

export function createTuiRuntimeDescriptor(params: {
    sessionId: string;
    cwd: string;
    permissions: PermissionSettings | undefined;
    callbacks: SendMessageCallbacks;
}): {
    sessionId: string;
    cwd: string;
    permissionPolicy: {
        evaluate: (request: { target?: string }) => Promise<'allow' | 'deny' | 'ask'>;
    };
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<'allow' | 'deny'>;
    requestQuestion: (request: AgentQuestionRequest) => Promise<AgentQuestionAnswer>;
} {
    const {
        sessionId,
        cwd,
        permissions,
        callbacks,
    } = params;

    return {
        sessionId,
        cwd,
        permissionPolicy: {
            evaluate: async (request: { target?: string }) => {
                const target = typeof request.target === 'string' ? request.target : '';
                const mode = resolveRemoteToolPermissionMode(target, permissions);
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
}
