import type {
  JsonRecord,
  JsonValue,
  MessageContentPart,
  MessageToolCall,
} from '@xqoder/protocol';

export interface RuntimeSessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cost?: number;
}

export interface RuntimeSessionAttachment {
  kind?: 'image' | 'file' | 'text';
  type?: 'image' | 'file';
  mimeType?: string;
  data?: string;
  fileName?: string;
  filePath?: string;
  text?: string;
  url?: string;
  metadata?: JsonRecord;
}

export interface RuntimeSessionMetadataSnapshot {
  compactSummary?: string;
  compactions: JsonValue[];
  toolHistory: JsonValue[];
  commandHistory: JsonValue[];
  fileChanges: JsonValue[];
  fixHistory?: JsonRecord;
}

export interface RuntimeSessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  thinking?: string;
  toolCalls?: MessageToolCall[];
  attachments?: RuntimeSessionAttachment[];
  parts?: MessageContentPart[];
}

export interface RuntimeSessionSnapshot {
  id: string;
  title?: string;
  createdAt: Date;
  maxMessages: number;
  messages: RuntimeSessionMessage[];
  usage: RuntimeSessionUsage;
  metadata: RuntimeSessionMetadataSnapshot;
}

export interface RuntimeSessionSummary {
  id: string;
  projectRoot: string;
  cwd: string;
  model: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  maxMessages: number;
  messageCount: number;
  usage: RuntimeSessionUsage;
  lastUserMessage?: string;
  compactionCount: number;
  commandCount: number;
  fileChangeCount: number;
}

export interface RuntimeSessionSaveInput {
  snapshot: RuntimeSessionSnapshot;
  projectRoot: string;
  cwd: string;
  model: string;
}

export interface RuntimeSessionAppendInput {
  sessionId: string;
  message: RuntimeSessionMessage;
  projectRoot: string;
  cwd: string;
  model: string;
  title?: string;
}

export interface RuntimeSessionStoreDefaults {
  projectRoot?: string;
  model?: string;
}

export interface RuntimeSessionBackingStore {
  getSessionSnapshot(sessionId: string): RuntimeSessionSnapshot | null;
  getSessionSummary(sessionId: string): RuntimeSessionSummary | null;
  listSessions(projectRoot?: string, limit?: number): RuntimeSessionSummary[];
  saveSessionSnapshot(input: RuntimeSessionSaveInput): RuntimeSessionSummary;
  appendSessionMessage?(input: RuntimeSessionAppendInput): RuntimeSessionSummary;
}
