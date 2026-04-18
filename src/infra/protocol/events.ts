import type { JsonRecord, JsonValue } from './json.js';
import type { CoreMessage } from './messages.js';

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
}

export interface ErrorEvent extends EventEnvelope {
  type: 'error';
  message: string;
  recoverable?: boolean;
}

export interface ThoughtEvent extends EventEnvelope {
  type: 'thought';
  text: string;
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
  | ErrorEvent;
