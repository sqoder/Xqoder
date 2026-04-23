import type { PermissionPolicy } from '@xqoder/permissions';
import type { ConversationEventEnvelope, CoreMessage, JsonRecord, JsonValue, MessageAttachment } from '@xqoder/protocol';
import type { ToolApprovalPrompt } from '../../domain/permissions/index.js';

export type { ToolApprovalPrompt } from '../../domain/permissions/index.js';

export interface RuntimeDescriptor {
  sessionId: string;
  cwd: string;
  turnId?: string;
  workspaceId?: string;
  userId?: string;
  permissionPolicy: PermissionPolicy;
  emit?(event: ConversationEventEnvelope): void | Promise<void>;
  requestToolApproval?(request: ToolApprovalPrompt): Promise<'allow' | 'deny'> | 'allow' | 'deny';
  requestQuestion?(request: QuestionPrompt): Promise<QuestionAnswer> | QuestionAnswer;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionPrompt {
  requestId: string;
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  allowCustom?: boolean;
}

export interface QuestionAnswer {
  requestId: string;
  selected: string[];
  customText?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: JsonValue;
  requiresApproval?: boolean;
}

export interface ToolResult {
  success: boolean;
  output: string;
  metadata?: JsonRecord;
}

export interface ModelInput {
  messages: CoreMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  metadata?: JsonRecord;
}

export interface AgentTask {
  prompt: string;
  messages: CoreMessage[];
  attachments?: MessageAttachment[];
  metadata?: JsonRecord;
}

export interface AuthSession {
  provider: string;
  accessToken: string;
  expiresAt?: number;
  metadata?: JsonRecord;
}

export interface SyncConnectionOptions {
  sessionId: string;
  metadata?: JsonRecord;
}

export interface NamedCapability {
  name: string;
}

export interface ModelProvider extends NamedCapability {
  stream(input: ModelInput, runtime: RuntimeDescriptor): AsyncIterable<ConversationEventEnvelope>;
}

export interface AgentProvider extends NamedCapability {
  run(task: AgentTask, runtime: RuntimeDescriptor): AsyncIterable<ConversationEventEnvelope>;
}

export interface ToolProvider extends NamedCapability {
  tools(): ToolDefinition[];
  execute(name: string, args: JsonValue, runtime: RuntimeDescriptor): Promise<ToolResult>;
}

export interface SyncProvider extends NamedCapability {
  connect(options: SyncConnectionOptions, runtime: RuntimeDescriptor): AsyncIterable<ConversationEventEnvelope>;
}

export interface AuthProvider extends NamedCapability {
  resolve(runtime: RuntimeDescriptor): Promise<AuthSession>;
}
