import * as path from 'node:path';
import {
    configManager,
    getMessageAttachmentKind,
    resolveConfigWithEnvOverrides,
    type LLMMessage,
    type MessageAttachment as SharedMessageAttachment,
} from '@xqoder/shared';
import {
    AgentSession,
    SummarizerAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentSessionSnapshot,
    type RuntimeAgentSessionStore,
} from '@xqoder/agent';
import type { RuntimeKernel } from '@xqoder/runtime';
import type { CoreMessage, JsonValue, MessageAttachment as ProtocolMessageAttachment } from '@xqoder/protocol';
import { resolveSessionById } from '../services/session-resolve.js';

export interface CrashRecoveryCheckpoint {
    cwd: string;
    projectRoot: string;
    model: string;
    title?: string;
}

export interface SessionSnapshotSource {
    getSessionSnapshot?: () => AgentSessionSnapshot;
}

export interface PersistSessionSnapshotInput {
    session: AgentSession;
    cwd: string;
    projectRoot: string;
    model: string;
    title?: string;
}

export interface ReplaceSessionMessagesInput {
    sessionId: string;
    cwd: string;
    projectRoot: string;
    model: string;
    title?: string;
    messages: LLMMessage[];
}

export interface CompactSessionSettings {
    dir: string;
    model: string;
    agent: string;
}

export function toProtocolAttachment(attachment: SharedMessageAttachment): ProtocolMessageAttachment {
    const kind = getMessageAttachmentKind(attachment);
    return {
        kind,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        ...(attachment.url ? { url: attachment.url } : {}),
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
        ...(message.thinking ? { thinking: message.thinking } : {}),
        ...(message.toolCalls && message.toolCalls.length > 0
            ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
            : {}),
        ...(message.attachments && message.attachments.length > 0
            ? { attachments: message.attachments.map(toProtocolAttachment) }
            : {}),
        ...(message.parts && message.parts.length > 0
            ? {
                parts: message.parts.map((part) => {
                    if (part.type === 'tool_call') {
                        return {
                            ...part,
                            toolCall: { ...part.toolCall },
                        };
                    }
                    return { ...part };
                }),
            }
            : {}),
    };
}

function toRuntimeJsonValue(value: unknown): JsonValue {
    if (value === null) {
        return null;
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toRuntimeJsonValue(entry));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entry]) => entry !== undefined)
                .map(([key, entry]) => [key, toRuntimeJsonValue(entry)]),
        ) as Record<string, JsonValue>;
    }
    return null;
}

export function toRuntimeSessionMetadata(
    session: AgentSession,
    projectRoot: string,
    model: string,
): Record<string, JsonValue> {
    const snapshot = session.toSnapshot();
    return {
        projectRoot: path.resolve(projectRoot),
        model,
        maxMessages: snapshot.maxMessages,
        promptTokens: snapshot.usage.promptTokens,
        completionTokens: snapshot.usage.completionTokens,
        totalTokens: snapshot.usage.totalTokens,
        ...(snapshot.usage.cacheReadTokens !== undefined ? { cacheReadTokens: snapshot.usage.cacheReadTokens } : {}),
        ...(snapshot.usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: snapshot.usage.cacheCreationTokens } : {}),
        ...(snapshot.usage.cost !== undefined ? { cost: snapshot.usage.cost } : {}),
        ...(snapshot.metadata.compactSummary ? { compactSummary: snapshot.metadata.compactSummary } : {}),
        compactions: toRuntimeJsonValue(snapshot.metadata.compactions),
        toolHistory: toRuntimeJsonValue(snapshot.metadata.toolHistory),
        commandHistory: toRuntimeJsonValue(snapshot.metadata.commandHistory),
        fileChanges: toRuntimeJsonValue(snapshot.metadata.fileChanges),
        ...(snapshot.metadata.fixHistory ? { fixHistory: toRuntimeJsonValue(snapshot.metadata.fixHistory) } : {}),
    };
}

export function persistCrashRecoverySnapshot(
    sessionStore: RuntimeAgentSessionStore,
    checkpoint: CrashRecoveryCheckpoint | null,
    snapshotSource: SessionSnapshotSource | null,
): void {
    const snapshot = snapshotSource?.getSessionSnapshot?.();
    if (!checkpoint || !snapshot) {
        return;
    }

    try {
        sessionStore.saveSessionSnapshot({
            session: AgentSession.fromSnapshot(snapshot),
            cwd: checkpoint.cwd,
            projectRoot: checkpoint.projectRoot,
            model: checkpoint.model,
            ...(snapshot.title ?? checkpoint.title ? { title: snapshot.title ?? checkpoint.title } : {}),
        });
    } catch {
        // Crash-recovery checkpointing is best-effort.
    }
}

export async function loadSessionFromRuntime(
    runtime: RuntimeKernel,
    sessionId: string,
): Promise<AgentSession | undefined> {
    const resolved = await resolveSessionById(runtime, sessionId);
    return resolved?.session;
}

export async function persistRuntimeSessionSnapshot(
    runtime: RuntimeKernel,
    input: PersistSessionSnapshotInput,
): Promise<void> {
    const resolvedCwd = path.resolve(input.cwd);
    const snapshot = input.session.toSnapshot();
    await runtime.upsertSession({
        sessionId: input.session.id,
        createdAt: snapshot.createdAt.getTime(),
        ...(input.title ? { title: input.title } : {}),
        cwd: resolvedCwd,
        metadata: toRuntimeSessionMetadata(input.session, input.projectRoot, input.model),
        messages: snapshot.messages.map((message, index) => toCoreMessage(message, input.session.id, index)),
    });
}

export async function replaceRuntimeSessionMessages(
    runtime: RuntimeKernel,
    input: ReplaceSessionMessagesInput,
): Promise<void> {
    const current = await loadSessionFromRuntime(runtime, input.sessionId);
    const snapshot = current
        ? current.toSnapshot()
        : new AgentSession({
            id: input.sessionId,
            ...(input.title ? { title: input.title } : {}),
        }).toSnapshot();
    snapshot.messages = input.messages;
    if (input.title) {
        snapshot.title = input.title;
    }

    await persistRuntimeSessionSnapshot(runtime, {
        session: AgentSession.fromSnapshot(snapshot),
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        model: input.model,
        title: input.title,
    });
}

export async function compactRuntimeSession(
    runtime: RuntimeKernel,
    sessionId: string,
    settings: CompactSessionSettings,
): Promise<string | null> {
    try {
        const session = await loadSessionFromRuntime(runtime, sessionId);
        if (!session) {
            return null;
        }

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

        const messages = session.getMessages().filter((message: LLMMessage) => message.role !== 'system');
        if (messages.length < 4) {
            return null;
        }
        session.setCompactionReservedMessages(agentConfig.compaction?.reserved);
        const plan = session.createCompactionPlan({
            reservedMessages: agentConfig.compaction?.reserved,
        });
        if (plan.compactedMessages.length === 0) {
            return null;
        }

        const summarizer = new SummarizerAgent(agentConfig.llmConfig);
        const summary = await summarizer.summarizeForCompaction({
            priorSummary: plan.priorSummary,
            compactedMessages: plan.compactedMessages,
            recentMessages: plan.recentMessages,
        });
        if (!summary?.trim()) {
            return null;
        }

        session.performCompaction(summary, {
            reservedMessages: agentConfig.compaction?.reserved,
        });
        await persistRuntimeSessionSnapshot(runtime, {
            session,
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
            title: session.getTitle(),
        });

        return summary;
    } catch {
        return null;
    }
}
