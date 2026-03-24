import type { SessionRecord } from '@xqoder/runtime';
import type {
  CoreMessage,
  JsonRecord,
  JsonValue,
  MessageAttachment as ProtocolAttachment,
  MessageContentPart,
  MessageToolCall,
} from '@xqoder/protocol';
import type {
  RuntimeSessionAttachment,
  RuntimeSessionAppendInput,
  RuntimeSessionBackingStore,
  RuntimeSessionMessage,
  RuntimeSessionMetadataSnapshot,
  RuntimeSessionSaveInput,
  RuntimeSessionSnapshot,
  RuntimeSessionStoreDefaults,
  RuntimeSessionSummary,
  RuntimeSessionUsage,
} from './runtime-session-types.js';

export type {
  RuntimeSessionAttachment,
  RuntimeSessionAppendInput,
  RuntimeSessionBackingStore,
  RuntimeSessionMessage,
  RuntimeSessionMetadataSnapshot,
  RuntimeSessionSaveInput,
  RuntimeSessionSnapshot,
  RuntimeSessionStoreDefaults,
  RuntimeSessionSummary,
  RuntimeSessionUsage,
} from './runtime-session-types.js';

export function cloneCoreMessage(message: CoreMessage): CoreMessage {
  return {
    ...message,
    ...(message.toolCalls
      ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
      : {}),
    ...(message.attachments
      ? {
          attachments: message.attachments.map((attachment) => ({
            ...attachment,
            ...(attachment.metadata ? { metadata: { ...attachment.metadata } } : {}),
          })),
        }
      : {}),
    ...(message.parts
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

export function cloneSessionRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    messages: record.messages.map(cloneCoreMessage),
    ...(record.metadata ? { metadata: { ...record.metadata } } : {}),
  };
}

function getRuntimeSessionAttachmentKind(attachment: Pick<RuntimeSessionAttachment, 'kind' | 'type'>): 'image' | 'file' {
  return attachment.kind === 'image' || attachment.type === 'image' ? 'image' : 'file';
}

function toProtocolAttachment(attachment: RuntimeSessionAttachment): ProtocolAttachment {
  const kind = getRuntimeSessionAttachmentKind(attachment);
  return {
    kind,
    mimeType: attachment.mimeType,
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
    ...(attachment.text ? { text: attachment.text } : {}),
    ...(attachment.url ? { url: attachment.url } : {}),
    ...(attachment.metadata ? { metadata: { ...attachment.metadata } } : {}),
  };
}

function toStoredAttachment(attachment: ProtocolAttachment): RuntimeSessionAttachment {
  const kind = attachment.kind === 'image' ? 'image' : 'file';
  return {
    kind,
    type: kind,
    mimeType: attachment.mimeType ?? (attachment.kind === 'image' ? 'image/png' : 'application/octet-stream'),
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
    ...(attachment.text ? { text: attachment.text } : {}),
    ...(attachment.url ? { url: attachment.url } : {}),
    ...(attachment.metadata ? { metadata: { ...attachment.metadata } } : {}),
  };
}

function toCoreRuntimeMessage(message: RuntimeSessionMessage, sessionId: string, createdAt: number, index: number): CoreMessage {
  return {
    id: `${sessionId}:stored:${index}`,
    sessionId,
    role: message.role,
    content: message.content,
    createdAt,
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
          }) as MessageContentPart[],
        }
      : {}),
  };
}

export function toStoredRuntimeMessage(message: CoreMessage): RuntimeSessionMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.thinking ? { thinking: message.thinking } : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) as MessageToolCall[] }
      : {}),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map(toStoredAttachment) }
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
          }) as RuntimeSessionMessage['parts'],
        }
      : {}),
  };
}

function toJsonCompatible(value: unknown): JsonValue {
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
    return value.map((entry) => toJsonCompatible(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toJsonCompatible(entry)]),
    ) as Record<string, JsonValue>;
  }
  return null;
}

function readMetadataArray(
  metadata: SessionRecord['metadata'] | RuntimeSessionMetadataSnapshot | undefined,
  key: 'compactions' | 'toolHistory' | 'commandHistory' | 'fileChanges',
): JsonValue[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.map((entry) => toJsonCompatible(entry)) : [];
}

function readCompactSummary(
  metadata: SessionRecord['metadata'] | RuntimeSessionMetadataSnapshot | undefined,
): string | undefined {
  const value = metadata?.['compactSummary'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readFixHistory(
  metadata: SessionRecord['metadata'] | RuntimeSessionMetadataSnapshot | undefined,
): JsonRecord | undefined {
  const value = metadata?.['fixHistory'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalized = toJsonCompatible(value);
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as JsonRecord
    : undefined;
}

function toRuntimeSessionMetadataSnapshot(
  metadata: SessionRecord['metadata'] | RuntimeSessionMetadataSnapshot | undefined,
): RuntimeSessionMetadataSnapshot {
  return {
    ...(readCompactSummary(metadata) ? { compactSummary: readCompactSummary(metadata) } : {}),
    compactions: readMetadataArray(metadata, 'compactions'),
    toolHistory: readMetadataArray(metadata, 'toolHistory'),
    commandHistory: readMetadataArray(metadata, 'commandHistory'),
    fileChanges: readMetadataArray(metadata, 'fileChanges'),
    ...(readFixHistory(metadata) ? { fixHistory: readFixHistory(metadata) } : {}),
  };
}

function toRecordMetadataFromSnapshot(
  snapshot: RuntimeSessionSnapshot,
): Partial<NonNullable<SessionRecord['metadata']>> {
  return {
    maxMessages: snapshot.maxMessages,
    promptTokens: snapshot.usage.promptTokens,
    completionTokens: snapshot.usage.completionTokens,
    totalTokens: snapshot.usage.totalTokens,
    ...(snapshot.usage.cacheReadTokens !== undefined ? { cacheReadTokens: snapshot.usage.cacheReadTokens } : {}),
    ...(snapshot.usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: snapshot.usage.cacheCreationTokens } : {}),
    ...(snapshot.usage.cost !== undefined ? { cost: snapshot.usage.cost } : {}),
    ...(readCompactSummary(snapshot.metadata) ? { compactSummary: readCompactSummary(snapshot.metadata) } : {}),
    compactions: readMetadataArray(snapshot.metadata, 'compactions'),
    toolHistory: readMetadataArray(snapshot.metadata, 'toolHistory'),
    commandHistory: readMetadataArray(snapshot.metadata, 'commandHistory'),
    fileChanges: readMetadataArray(snapshot.metadata, 'fileChanges'),
    ...(readFixHistory(snapshot.metadata) ? { fixHistory: readFixHistory(snapshot.metadata) } : {}),
  };
}

export function mergeRuntimeSummaryMetadata(
  summary: RuntimeSessionSummary,
  snapshot: RuntimeSessionSnapshot,
  existing?: SessionRecord['metadata'],
): NonNullable<SessionRecord['metadata']> {
  const preserved = existing ? { ...existing } : {};
  delete preserved['projectRoot'];
  delete preserved['model'];
  delete preserved['maxMessages'];
  delete preserved['messageCount'];
  delete preserved['commandCount'];
  delete preserved['fileChangeCount'];
  delete preserved['compactionCount'];
  delete preserved['promptTokens'];
  delete preserved['completionTokens'];
  delete preserved['totalTokens'];
  delete preserved['cacheReadTokens'];
  delete preserved['cacheCreationTokens'];
  delete preserved['cost'];
  delete preserved['lastUserMessage'];

  return {
    ...preserved,
    ...toRecordMetadataFromSnapshot(snapshot),
    projectRoot: summary.projectRoot,
    model: summary.model,
    ...(summary.lastUserMessage ? { lastUserMessage: summary.lastUserMessage } : {}),
  };
}

export function buildRuntimeSessionSaveInput(
  record: SessionRecord,
  defaults: RuntimeSessionStoreDefaults = {},
): RuntimeSessionSaveInput {
  return {
    snapshot: toRuntimeSessionSnapshot(record),
    projectRoot: String(record.metadata?.['projectRoot'] ?? defaults.projectRoot ?? record.cwd),
    cwd: record.cwd,
    model: String(record.metadata?.['model'] ?? defaults.model ?? 'unknown'),
  };
}

export function toPersistedSessionRecord(
  summary: RuntimeSessionSummary,
  snapshot: RuntimeSessionSnapshot,
  existing?: SessionRecord,
): SessionRecord {
  return {
    id: summary.id,
    cwd: summary.cwd,
    title: summary.title,
    createdAt: summary.createdAt.getTime(),
    updatedAt: summary.updatedAt.getTime(),
    messages: existing
      ? existing.messages.map(cloneCoreMessage)
      : snapshot.messages.map((message, index) =>
          toCoreRuntimeMessage(message, summary.id, summary.createdAt.getTime(), index),
        ),
    metadata: mergeRuntimeSummaryMetadata(summary, snapshot, existing?.metadata),
  };
}

export function toSessionRecord(summary: RuntimeSessionSummary, snapshot: RuntimeSessionSnapshot): SessionRecord {
  return toPersistedSessionRecord(summary, snapshot);
}

export function toRuntimeSessionSnapshot(record: SessionRecord): RuntimeSessionSnapshot {
  return {
    id: record.id,
    title: record.title,
    createdAt: new Date(record.createdAt),
    maxMessages: Number(record.metadata?.['maxMessages'] ?? 100),
    messages: record.messages.map(toStoredRuntimeMessage),
    usage: {
      promptTokens: Number(record.metadata?.['promptTokens'] ?? 0),
      completionTokens: Number(record.metadata?.['completionTokens'] ?? 0),
      totalTokens: Number(record.metadata?.['totalTokens'] ?? 0),
      ...(typeof record.metadata?.['cacheReadTokens'] === 'number'
        ? { cacheReadTokens: Number(record.metadata['cacheReadTokens']) }
        : {}),
      ...(typeof record.metadata?.['cacheCreationTokens'] === 'number'
        ? { cacheCreationTokens: Number(record.metadata['cacheCreationTokens']) }
        : {}),
      ...(typeof record.metadata?.['cost'] === 'number'
        ? { cost: Number(record.metadata['cost']) }
        : {}),
    },
    metadata: toRuntimeSessionMetadataSnapshot(record.metadata),
  };
}
