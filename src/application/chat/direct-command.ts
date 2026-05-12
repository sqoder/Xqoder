import { configManager, type ConfigManager } from '@xqoder/shared';
import {
    SummarizerAgent,
    XQoderAgent,
} from '@xqoder/agent';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type {
    AppEvent,
    ConversationEventEnvelope,
} from '@xqoder/protocol';
import {
    createPermissionsSnapshot,
    formatPermissionsSnapshot,
} from '../system/permissions.js';
import type {
    ChatTurnIntakeDependencies,
    PreparedChatExecution,
} from './turn-intake.js';

export interface DirectChatCommandDependencies extends ChatTurnIntakeDependencies {
    listVisibleTools?: (
        execution: PreparedChatExecution,
    ) => Promise<Array<{ name: string; description?: string; permissionMode: string }>>;
    compactSession?: (
        execution: PreparedChatExecution,
    ) => Promise<string | null | undefined>;
}

export async function resolveDirectChatCommandResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies = {},
): Promise<string | undefined> {
    const commandRoute = execution.turnInput.runtime.commandRoute;
    switch (commandRoute.kind) {
        case 'status':
            return buildStatusResponse(execution);
        case 'permissions':
            return buildPermissionsResponse(execution, dependencies);
        case 'tools':
            return await buildToolsResponse(execution, dependencies);
        case 'compact':
            return await buildCompactResponse(execution, dependencies);
        case 'help':
            return buildHelpResponse();
        case 'usage':
            return commandRoute.response;
        default:
            return undefined;
    }
}

export function resolveDirectCommandSessionId(
    execution: PreparedChatExecution,
    sessionIdOverride?: string,
): string {
    return sessionIdOverride
        ?? execution.agentConfig.session?.id
        ?? `direct:${Date.now()}`;
}

export function emitDirectChatRuntimeEvents(params: {
    execution: PreparedChatExecution;
    response: string;
    onEvent: (event: ConversationEventEnvelope) => void;
    sessionIdOverride?: string;
}): { response: string; sessionId: string } {
    const {
        execution,
        response,
        onEvent,
        sessionIdOverride,
    } = params;
    const sessionId = resolveDirectCommandSessionId(execution, sessionIdOverride);
    const userMessageId = `${sessionId}:user:${Date.now()}`;
    const assistantMessageId = `${sessionId}:assistant:${Date.now()}`;
    const now = Date.now();
    const eventEmitter = createConversationEventEnvelopeEmitter(sessionId);
    const emitEvent = (event: AppEvent): void => {
        onEvent(eventEmitter.emit(event));
    };

    emitEvent(
        execution.agentConfig.session
            ? {
                type: 'session.resumed',
                sessionId,
                timestamp: now,
                source: 'runtime',
                messageCount: execution.agentConfig.session.getMessages().length,
            }
            : {
                type: 'session.started',
                sessionId,
                timestamp: now,
                source: 'runtime',
                cwd: execution.turnInput.resolvedDir,
            },
    );
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: {
            id: userMessageId,
            sessionId,
            role: 'user',
            content: execution.turnInput.rawPrompt,
            createdAt: now,
            ...(execution.turnInput.attachments.length > 0
                ? {
                    attachments: execution.turnInput.attachments.map((attachment) => ({
                        kind: attachment.type,
                        mimeType: attachment.mimeType,
                        data: attachment.data,
                        fileName: attachment.fileName,
                        filePath: attachment.filePath,
                    })),
                }
                : {}),
        },
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        message: {
            id: userMessageId,
            sessionId,
            role: 'user',
            content: execution.turnInput.rawPrompt,
            createdAt: now,
            ...(execution.turnInput.attachments.length > 0
                ? {
                    attachments: execution.turnInput.attachments.map((attachment) => ({
                        kind: attachment.type,
                        mimeType: attachment.mimeType,
                        data: attachment.data,
                        fileName: attachment.fileName,
                        filePath: attachment.filePath,
                    })),
                }
                : {}),
        },
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now,
        source: 'runtime',
        status: 'thinking',
    });
    emitEvent({
        type: 'message.started',
        sessionId,
        timestamp: now + 1,
        source: 'runtime',
        message: {
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: '',
            createdAt: now + 1,
        },
    });
    emitEvent({
        type: 'message.completed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        message: {
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            content: response,
            createdAt: now + 1,
        },
    });
    emitEvent({
        type: 'status.changed',
        sessionId,
        timestamp: now + 2,
        source: 'runtime',
        status: 'done',
        stopReason: 'completed',
    });

    return {
        response,
        sessionId,
    };
}

function buildStatusResponse(
    execution: PreparedChatExecution,
): string {
    return [
        'Runtime status:',
        `session=${execution.agentConfig.session?.id ?? 'new'}`,
        `cwd=${execution.turnInput.resolvedDir}`,
        `agent=${execution.agentConfig.agentName ?? 'unknown'}`,
        `model=${execution.agentConfig.llmConfig.model}`,
        `runtimeProfile=${execution.turnInput.runtime.runtimeDecision.runtimeProfile}`,
        `interaction=${execution.turnInput.runtime.interaction.kind}`,
        `persistence=${execution.turnInput.shouldPersistSession ? 'enabled' : 'disabled'}`,
    ].join('\n');
}

function buildPermissionsResponse(
    execution: PreparedChatExecution,
    dependencies: ChatTurnIntakeDependencies,
): string {
    const snapshot = createPermissionsSnapshot(
        { cwd: execution.turnInput.resolvedDir },
        resolvePermissionsSnapshotManager(dependencies.configManager),
    );
    return formatPermissionsSnapshot(snapshot);
}

function resolvePermissionsSnapshotManager(
    manager: ChatTurnIntakeDependencies['configManager'] | undefined,
): Pick<ConfigManager, 'load' | 'getLoadMetadata'> {
    if (manager && typeof (manager as { getLoadMetadata?: unknown }).getLoadMetadata === 'function') {
        return manager as Pick<ConfigManager, 'load' | 'getLoadMetadata'>;
    }
    return configManager;
}

async function buildToolsResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): Promise<string> {
    const tools = dependencies.listVisibleTools
        ? await dependencies.listVisibleTools(execution)
        : await listVisibleToolsFromAgent(execution);
    if (tools.length === 0) {
        return 'No visible tools for this turn.';
    }

    return [
        'Visible tools for this turn:',
        ...tools.map((tool) => {
            const description = tool.description?.trim()
                ? ` - ${tool.description.trim()}`
                : '';
            return `- ${tool.name} (${tool.permissionMode})${description}`;
        }),
    ].join('\n');
}

async function buildCompactResponse(
    execution: PreparedChatExecution,
    dependencies: DirectChatCommandDependencies,
): Promise<string> {
    const overriddenSummary = dependencies.compactSession
        ? await dependencies.compactSession(execution)
        : undefined;
    if (overriddenSummary !== undefined && overriddenSummary !== null) {
        return overriddenSummary;
    }

    const session = execution.agentConfig.session;
    if (!session) {
        return 'No active session to compact.';
    }

    const messages = session.getMessages().filter((message) => message.role !== 'system');
    if (messages.length < 4) {
        return 'Session compaction unavailable or not needed yet.';
    }

    const summarizer = new SummarizerAgent(execution.agentConfig.llmConfig);
    const summary = await summarizer.summarize(messages);
    if (!summary?.trim()) {
        return 'Session compaction unavailable or not needed yet.';
    }

    session.performCompaction(summary);
    execution.sessionStore?.saveSession({
        session,
        projectRoot: execution.turnInput.resolvedDir,
        cwd: execution.turnInput.resolvedDir,
        model: execution.agentConfig.llmConfig.model,
    });
    return summary;
}

async function listVisibleToolsFromAgent(
    execution: PreparedChatExecution,
): Promise<Array<{ name: string; description?: string; permissionMode: string }>> {
    const agent = new XQoderAgent(execution.agentConfig);

    try {
        return await agent.listVisibleTools();
    } finally {
        await agent.dispose();
    }
}

function buildHelpResponse(): string {
    return [
        'XQoder slash commands:',
        '  /help, /?              Show this help',
        '  /status, /stats        Show runtime status',
        '  /permissions, /auth    Show permission snapshot',
        '  /tools                 List visible tools for this turn',
        '  /compact, /compress    Compact the current session history',
        '  /plan <goal>           Run the plan workflow',
        '  /review <scope>        Run the review workflow',
        '  /implement <goal>      Implement an approved plan',
        '  /skill <name> [goal]   Load a skill and follow it',
        '',
        'Reference @path/to/file.ext in your message to auto-attach the file.',
    ].join('\n');
}
