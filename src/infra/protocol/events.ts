import type { JsonRecord, JsonValue } from './json.js';
import type { CoreMessage } from './messages.js';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

export type EventSource = 'runtime' | 'ui' | 'model' | 'agent' | 'tool' | 'plugin' | 'sync';

export type RunStatus = 'idle' | 'thinking' | 'running-tool' | 'awaiting-approval' | 'done' | 'error';

export interface EventEnvelope {
  type: string;
  sessionId: string;
  timestamp: number;
  source: EventSource;
  metadata?: JsonRecord;
}

export interface SessionStartedEvent extends EventEnvelope {
  type: 'session.started';
  cwd: string;
}

export interface SessionResumedEvent extends EventEnvelope {
  type: 'session.resumed';
  messageCount: number;
}

export interface MessageStartedEvent extends EventEnvelope {
  type: 'message.started';
  message: CoreMessage;
}

export interface MessageDeltaEvent extends EventEnvelope {
  type: 'message.delta';
  messageId: string;
  role: CoreMessage['role'];
  text: string;
}

export interface MessageCompletedEvent extends EventEnvelope {
  type: 'message.completed';
  message: CoreMessage;
}

export interface ToolCalledEvent extends EventEnvelope {
  type: 'tool.called';
  provider: string;
  tool: string;
  args: JsonValue;
}

export interface ToolOutputEvent extends EventEnvelope {
  type: 'tool.output';
  provider: string;
  tool: string;
  output: string;
  partial?: boolean;
}

export interface ToolCompletedEvent extends EventEnvelope {
  type: 'tool.completed';
  provider: string;
  tool: string;
  success: boolean;
}

export interface ApprovalRequestedEvent extends EventEnvelope {
  type: 'approval.requested';
  requestId: string;
  kind: string;
  summary: string;
  payload?: JsonValue;
}

export interface ApprovalResolvedEvent extends EventEnvelope {
  type: 'approval.resolved';
  requestId: string;
  decision: 'allow' | 'ask' | 'deny';
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionRequestedEvent extends EventEnvelope {
  type: 'question.requested';
  requestId: string;
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  allowCustom?: boolean;
}

export interface QuestionResolvedEvent extends EventEnvelope {
  type: 'question.resolved';
  requestId: string;
  selected: string[];
  customText?: string;
  answerSource: 'ui' | 'fallback';
}

export interface StatusChangedEvent extends EventEnvelope {
  type: 'status.changed';
  status: RunStatus;
  stopReason?: ConversationStopReason;
  message?: string;
}

export interface ErrorEvent extends EventEnvelope {
  type: 'error';
  message: string;
  recoverable?: boolean;
  stopReason?: ConversationStopReason;
}

export interface ThoughtEvent extends EventEnvelope {
  type: 'thought';
  text: string;
}

export interface UsageEvent extends EventEnvelope {
  type: 'usage';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface VerificationCompletedEvent extends EventEnvelope {
  type: 'verification.completed';
  ok: boolean;
  blocked: boolean;
  summary: string;
}

export type AppEvent =
  | SessionStartedEvent
  | SessionResumedEvent
  | MessageStartedEvent
  | MessageDeltaEvent
  | MessageCompletedEvent
  | ToolCalledEvent
  | ToolOutputEvent
  | ToolCompletedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | QuestionRequestedEvent
  | QuestionResolvedEvent
  | StatusChangedEvent
  | ThoughtEvent
  | UsageEvent
  | VerificationCompletedEvent
  | ErrorEvent;

interface ConversationEventPayloadBase {
  source: EventSource;
  metadata?: JsonRecord;
}

export interface ConversationEventPayloadMap {
  'session.started': ConversationEventPayloadBase & {
    cwd: string;
  };
  'session.resumed': ConversationEventPayloadBase & {
    messageCount: number;
  };
  'message.started': ConversationEventPayloadBase & {
    message: CoreMessage;
  };
  'message.delta': ConversationEventPayloadBase & {
    messageId: string;
    role: CoreMessage['role'];
    text: string;
  };
  'message.completed': ConversationEventPayloadBase & {
    message: CoreMessage;
  };
  'tool.called': ConversationEventPayloadBase & {
    provider: string;
    tool: string;
    args: JsonValue;
  };
  'tool.output': ConversationEventPayloadBase & {
    provider: string;
    tool: string;
    output: string;
    partial?: boolean;
  };
  'tool.completed': ConversationEventPayloadBase & {
    provider: string;
    tool: string;
    success: boolean;
  };
  'approval.requested': ConversationEventPayloadBase & {
    requestId: string;
    kind: string;
    summary: string;
    payload?: JsonValue;
  };
  'approval.resolved': ConversationEventPayloadBase & {
    requestId: string;
    decision: 'allow' | 'ask' | 'deny';
  };
  'question.requested': ConversationEventPayloadBase & {
    requestId: string;
    question: string;
    header?: string;
    options: QuestionOption[];
    multiple?: boolean;
    allowCustom?: boolean;
  };
  'question.resolved': ConversationEventPayloadBase & {
    requestId: string;
    selected: string[];
    customText?: string;
    answerSource: 'ui' | 'fallback';
  };
  'status.changed': ConversationEventPayloadBase & {
    status: RunStatus;
    stopReason?: ConversationStopReason;
    message?: string;
  };
  thought: ConversationEventPayloadBase & {
    text: string;
  };
  usage: ConversationEventPayloadBase & {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  'verification.completed': ConversationEventPayloadBase & {
    ok: boolean;
    blocked: boolean;
    summary: string;
  };
  error: ConversationEventPayloadBase & {
    message: string;
    recoverable?: boolean;
    stopReason?: ConversationStopReason;
  };
}

export type ConversationEventType = keyof ConversationEventPayloadMap;

export type ConversationEventEnvelopeRecord = {
  [TType in ConversationEventType]: {
    schemaVersion: 1;
    eventId: string;
    sessionId: string;
    turnId: string;
    timestamp: string;
    type: TType;
    payload: ConversationEventPayloadMap[TType];
  };
}[ConversationEventType];

export type ConversationEventEnvelope<
  TType extends ConversationEventType = ConversationEventType,
> = Extract<ConversationEventEnvelopeRecord, { type: TType }>;

export interface ConversationEventEnvelopeEmitter {
  readonly turnId: string;
  emit(event: AppEvent): ConversationEventEnvelopeRecord;
  emitRecord<TType extends ConversationEventType>(
    type: TType,
    payload: ConversationEventPayloadMap[TType],
  ): ConversationEventEnvelope<TType>;
}

function toConversationEventPayloadBase(event: EventEnvelope): ConversationEventPayloadBase {
  return {
    source: event.source,
    ...(event.metadata ? { metadata: event.metadata } : {}),
  };
}

export function toConversationEventEnvelope(
  event: AppEvent,
  context: { eventId: string; turnId: string },
): ConversationEventEnvelopeRecord {
  const envelopeBase = {
    schemaVersion: 1 as const,
    eventId: context.eventId,
    sessionId: event.sessionId,
    turnId: context.turnId,
    timestamp: new Date(event.timestamp).toISOString(),
    type: event.type,
  };

  switch (event.type) {
    case 'session.started':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          cwd: event.cwd,
        },
      };
    case 'session.resumed':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          messageCount: event.messageCount,
        },
      };
    case 'message.started':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          message: event.message,
        },
      };
    case 'message.delta':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          messageId: event.messageId,
          role: event.role,
          text: event.text,
        },
      };
    case 'message.completed':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          message: event.message,
        },
      };
    case 'tool.called':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          provider: event.provider,
          tool: event.tool,
          args: event.args,
        },
      };
    case 'tool.output':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          provider: event.provider,
          tool: event.tool,
          output: event.output,
          ...(event.partial !== undefined ? { partial: event.partial } : {}),
        },
      };
    case 'tool.completed':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          provider: event.provider,
          tool: event.tool,
          success: event.success,
        },
      };
    case 'approval.requested':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          requestId: event.requestId,
          kind: event.kind,
          summary: event.summary,
          ...(event.payload !== undefined ? { payload: event.payload } : {}),
        },
      };
    case 'approval.resolved':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          requestId: event.requestId,
          decision: event.decision,
        },
      };
    case 'question.requested':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          requestId: event.requestId,
          question: event.question,
          ...(event.header ? { header: event.header } : {}),
          options: event.options,
          ...(event.multiple ? { multiple: event.multiple } : {}),
          ...(event.allowCustom ? { allowCustom: event.allowCustom } : {}),
        },
      };
    case 'question.resolved':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          requestId: event.requestId,
          selected: event.selected,
          ...(event.customText ? { customText: event.customText } : {}),
          answerSource: event.answerSource,
        },
      };
    case 'status.changed':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          status: event.status,
          ...(event.stopReason !== undefined ? { stopReason: event.stopReason } : {}),
          ...(event.message !== undefined ? { message: event.message } : {}),
        },
      };
    case 'thought':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          text: event.text,
        },
      };
    case 'usage':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          model: event.model,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          ...(event.cost !== undefined ? { cost: event.cost } : {}),
        },
      };
    case 'verification.completed':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          ok: event.ok,
          blocked: event.blocked,
          summary: event.summary,
        },
      };
    case 'error':
      return {
        ...envelopeBase,
        type: event.type,
        payload: {
          ...toConversationEventPayloadBase(event),
          message: event.message,
          ...(event.recoverable !== undefined ? { recoverable: event.recoverable } : {}),
          ...(event.stopReason !== undefined ? { stopReason: event.stopReason } : {}),
        },
      };
  }
}

export function createConversationEventEnvelopeRecord<
  TType extends ConversationEventType,
>(
  context: {
    eventId: string;
    sessionId: string;
    turnId: string;
    timestamp?: string;
  },
  type: TType,
  payload: ConversationEventPayloadMap[TType],
): ConversationEventEnvelope<TType> {
  return {
    schemaVersion: 1,
    eventId: context.eventId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    timestamp: context.timestamp ?? new Date().toISOString(),
    type,
    payload,
  } as ConversationEventEnvelope<TType>;
}

export function createConversationTurnId(sessionId: string, createdAt = Date.now()): string {
  return `${sessionId}:turn:${createdAt}`;
}

export function createConversationEventEnvelopeEmitter(
  sessionId: string,
  turnId = createConversationTurnId(sessionId),
): ConversationEventEnvelopeEmitter {
  let seq = 0;
  const nextEventId = (): string => {
    seq += 1;
    return `${turnId}:event:${seq}`;
  };

  return {
    turnId,
    emitRecord<TType extends ConversationEventType>(
      type: TType,
      payload: ConversationEventPayloadMap[TType],
    ): ConversationEventEnvelope<TType> {
      return createConversationEventEnvelopeRecord(
        {
          eventId: nextEventId(),
          sessionId,
          turnId,
        },
        type,
        payload,
      );
    },
    emit(event) {
      return toConversationEventEnvelope(event, {
        eventId: nextEventId(),
        turnId,
      });
    },
  };
}
