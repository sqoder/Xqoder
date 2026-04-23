import type {
    LLMMessage,
    MessageAttachment,
    SandboxMode,
} from '@xqoder/shared';
import type {
    ConversationEventEnvelope as ProtocolConversationEventEnvelope,
    ConversationEventPayloadMap as ProtocolConversationEventPayloadMap,
    ConversationEventType as ProtocolConversationEventType,
    CoreMessage,
    JsonRecord,
    JsonValue,
} from '@xqoder/protocol';
import type { ConversationTranscriptEntry } from '../../domain/conversation/messages.js';
import type {
    ToolApprovalRequest,
} from '../../domain/permissions/index.js';

export type AgentJsonPrimitive = string | number | boolean | null;
export type AgentJsonValue = JsonValue;
export type AgentJsonRecord = JsonRecord;

export type AgentEventSource = 'runtime' | 'ui' | 'model' | 'agent' | 'tool' | 'plugin' | 'sync';
export type AgentRunStatus = 'idle' | 'thinking' | 'running-tool' | 'awaiting-approval' | 'done' | 'error';
export type AgentRuntimeRole = 'system' | 'user' | 'assistant' | 'tool';
export type AgentRuntimeAttachmentKind = 'image' | 'file' | 'text';

export type AgentRuntimeMessageAttachment = NonNullable<CoreMessage['attachments']>[number];
export type AgentRuntimeMessage = CoreMessage;
export type AgentRuntimeEventType = ProtocolConversationEventType;
export type AgentRuntimeEventPayloadMap = ProtocolConversationEventPayloadMap;
export type AgentRuntimeEvent = ProtocolConversationEventEnvelope;

export type AgentSessionStartedEvent = ProtocolConversationEventEnvelope<'session.started'>;
export type AgentSessionResumedEvent = ProtocolConversationEventEnvelope<'session.resumed'>;
export type AgentMessageStartedEvent = ProtocolConversationEventEnvelope<'message.started'>;
export type AgentMessageDeltaEvent = ProtocolConversationEventEnvelope<'message.delta'>;
export type AgentMessageCompletedEvent = ProtocolConversationEventEnvelope<'message.completed'>;
export type AgentToolCalledEvent = ProtocolConversationEventEnvelope<'tool.called'>;
export type AgentToolOutputEvent = ProtocolConversationEventEnvelope<'tool.output'>;
export type AgentToolCompletedEvent = ProtocolConversationEventEnvelope<'tool.completed'>;
export type AgentApprovalRequestedEvent = ProtocolConversationEventEnvelope<'approval.requested'>;
export type AgentApprovalResolvedEvent = ProtocolConversationEventEnvelope<'approval.resolved'>;

export interface AgentQuestionOption {
    label: string;
    description?: string;
}

export interface AgentQuestionRequest {
    requestId: string;
    question: string;
    header?: string;
    options: AgentQuestionOption[];
    multiple?: boolean;
    allowCustom?: boolean;
}

export interface AgentQuestionAnswer {
    requestId: string;
    selected: string[];
    customText?: string;
}

export type AgentQuestionRequestedEvent = ProtocolConversationEventEnvelope<'question.requested'>;
export type AgentQuestionResolvedEvent = ProtocolConversationEventEnvelope<'question.resolved'>;
export type AgentStatusChangedEvent = ProtocolConversationEventEnvelope<'status.changed'>;
export type AgentThoughtEvent = ProtocolConversationEventEnvelope<'thought'>;
export type AgentUsageEvent = ProtocolConversationEventEnvelope<'usage'>;
export type AgentVerificationCompletedEvent = ProtocolConversationEventEnvelope<'verification.completed'>;
export type AgentErrorEvent = ProtocolConversationEventEnvelope<'error'>;

export interface LegacyAgentTokenEvent {
    type: 'token';
    content: string;
}

export interface LegacyAgentToolStartEvent {
    type: 'tool_start';
    name: string;
    args: Record<string, unknown>;
}

export interface LegacyAgentToolEndEvent {
    type: 'tool_end';
    name: string;
    result: string;
    success: boolean;
}

export interface LegacyAgentToolStreamEvent {
    type: 'tool_stream';
    name: string;
    chunk: string;
    stream: 'stdout' | 'stderr';
}

export interface LegacyAgentCompleteEvent {
    type: 'complete';
    response: string;
    sessionId: string;
}

export interface LegacyAgentErrorEvent {
    type: 'error';
    error: Error;
}

export type AgentEvent =
    | AgentRuntimeEvent
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
    onEvent: (event: AgentRuntimeEvent) => void;
    onToolApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
    onQuestion?: (request: AgentQuestionRequest) => Promise<AgentQuestionAnswer>;
}

export interface AgentConversationPort {
    readonly isBusy: boolean;
    onTitleGenerated?: (sessionId: string, title: string) => void;
    cancel(): void;
    compactSession(sessionId: string, settings: TuiAgentSettings): Promise<string | null>;
    sendMessage(
        message: string,
        sessionId: string | undefined,
        settings: TuiAgentSettings,
        attachments: MessageAttachment[],
        callbacks: SendMessageCallbacks,
    ): Promise<SendMessageResult>;
    dispose(): Promise<void>;
}

export interface AgentSessionListEntry {
    id: string;
    title: string;
    updatedAt: string;
    messageCount?: number;
}

export interface AgentSessionMessagesResponse {
    messages: LLMMessage[];
    conversationSignals?: ConversationTranscriptEntry[];
}

export interface AgentSessionBrowserPort {
    listSessions(projectRoot: string, limit?: number): Promise<AgentSessionListEntry[]>;
    getSessionMessages(sessionId: string): Promise<AgentSessionMessagesResponse>;
    createSession(projectRoot: string, title?: string): Promise<{ id: string; title: string }>;
}

export type RemoteAgentConversationPort = AgentConversationPort & AgentSessionBrowserPort;

export function hasAgentSessionBrowserPort(
    service: AgentConversationPort,
): service is RemoteAgentConversationPort {
    return (
        typeof (service as Partial<AgentSessionBrowserPort>).listSessions === 'function'
        && typeof (service as Partial<AgentSessionBrowserPort>).getSessionMessages === 'function'
        && typeof (service as Partial<AgentSessionBrowserPort>).createSession === 'function'
    );
}
