import type {
    LLMMessage,
    MessageAttachment,
    SandboxMode,
} from '@xqoder/shared';
import type {
    ToolApprovalDecision,
    ToolApprovalRequest,
} from '../../domain/permissions/index.js';

export type AgentJsonPrimitive = string | number | boolean | null;
export type AgentJsonValue =
    | AgentJsonPrimitive
    | AgentJsonValue[]
    | { [key: string]: AgentJsonValue };
export type AgentJsonRecord = Record<string, AgentJsonValue>;

export type AgentEventSource = 'runtime' | 'ui' | 'model' | 'agent' | 'tool' | 'plugin' | 'sync';
export type AgentRunStatus = 'idle' | 'thinking' | 'running-tool' | 'awaiting-approval' | 'done' | 'error';
export type AgentRuntimeRole = 'system' | 'user' | 'assistant' | 'tool';
export type AgentRuntimeAttachmentKind = 'image' | 'file' | 'text';

export interface AgentRuntimeMessageAttachment {
    kind: AgentRuntimeAttachmentKind;
    fileName?: string;
    filePath?: string;
    mimeType?: string;
    data?: string;
    text?: string;
    metadata?: AgentJsonRecord;
}

export interface AgentRuntimeMessage {
    id: string;
    sessionId: string;
    role: AgentRuntimeRole;
    content: string;
    createdAt: number;
    toolCallId?: string;
    attachments?: AgentRuntimeMessageAttachment[];
    metadata?: AgentJsonRecord;
}

export interface AgentEventEnvelope {
    type: string;
    sessionId: string;
    timestamp: number;
    source: AgentEventSource;
    metadata?: AgentJsonRecord;
}

export interface AgentSessionStartedEvent extends AgentEventEnvelope {
    type: 'session.started';
    cwd: string;
}

export interface AgentSessionResumedEvent extends AgentEventEnvelope {
    type: 'session.resumed';
    messageCount: number;
}

export interface AgentMessageStartedEvent extends AgentEventEnvelope {
    type: 'message.started';
    message: AgentRuntimeMessage;
}

export interface AgentMessageDeltaEvent extends AgentEventEnvelope {
    type: 'message.delta';
    messageId: string;
    role: AgentRuntimeRole;
    text: string;
}

export interface AgentMessageCompletedEvent extends AgentEventEnvelope {
    type: 'message.completed';
    message: AgentRuntimeMessage;
}

export interface AgentToolCalledEvent extends AgentEventEnvelope {
    type: 'tool.called';
    provider: string;
    tool: string;
    args: AgentJsonValue;
}

export interface AgentToolOutputEvent extends AgentEventEnvelope {
    type: 'tool.output';
    provider: string;
    tool: string;
    output: string;
    partial?: boolean;
}

export interface AgentToolCompletedEvent extends AgentEventEnvelope {
    type: 'tool.completed';
    provider: string;
    tool: string;
    success: boolean;
}

export interface AgentApprovalRequestedEvent extends AgentEventEnvelope {
    type: 'approval.requested';
    requestId: string;
    kind: string;
    summary: string;
    payload?: AgentJsonValue;
}

export interface AgentApprovalResolvedEvent extends AgentEventEnvelope {
    type: 'approval.resolved';
    requestId: string;
    decision: ToolApprovalDecision;
}

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

export interface AgentQuestionRequestedEvent extends AgentEventEnvelope, AgentQuestionRequest {
    type: 'question.requested';
}

export interface AgentQuestionResolvedEvent extends AgentEventEnvelope {
    type: 'question.resolved';
    requestId: string;
    selected: string[];
    customText?: string;
    answerSource: 'ui' | 'fallback';
}

export interface AgentStatusChangedEvent extends AgentEventEnvelope {
    type: 'status.changed';
    status: AgentRunStatus;
}

export interface AgentThoughtEvent extends AgentEventEnvelope {
    type: 'thought';
    text: string;
}

export interface AgentErrorEvent extends AgentEventEnvelope {
    type: 'error';
    message: string;
    recoverable?: boolean;
}

export type AgentRuntimeEvent =
    | AgentSessionStartedEvent
    | AgentSessionResumedEvent
    | AgentMessageStartedEvent
    | AgentMessageDeltaEvent
    | AgentMessageCompletedEvent
    | AgentToolCalledEvent
    | AgentToolOutputEvent
    | AgentToolCompletedEvent
    | AgentApprovalRequestedEvent
    | AgentApprovalResolvedEvent
    | AgentQuestionRequestedEvent
    | AgentQuestionResolvedEvent
    | AgentStatusChangedEvent
    | AgentThoughtEvent
    | AgentErrorEvent;

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

export interface AgentSessionBrowserPort {
    listSessions(projectRoot: string, limit?: number): Promise<AgentSessionListEntry[]>;
    getSessionMessages(sessionId: string): Promise<{ messages: LLMMessage[] }>;
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
