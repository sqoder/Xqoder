import type { PermissionPolicy } from '@xqoder/permissions';
import type { AppEvent, CoreMessage, JsonRecord, JsonValue, MessageAttachment } from '@xqoder/protocol';

export interface RuntimeDescriptor {
  sessionId: string;
  cwd: string;
  workspaceId?: string;
  userId?: string;
  permissionPolicy: PermissionPolicy;
  emit?(event: AppEvent): void | Promise<void>;
  requestToolApproval?(request: ToolApprovalPrompt): Promise<'allow' | 'deny'> | 'allow' | 'deny';
}

export interface ToolApprovalPrompt {
  toolCallId: string;
  toolName: string;
  summary: string;
  reason?: string;
  preview?: string;
  risk?: 'low' | 'medium' | 'high';
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
  stream(input: ModelInput, runtime: RuntimeDescriptor): AsyncIterable<AppEvent>;
}

export interface AgentProvider extends NamedCapability {
  run(task: AgentTask, runtime: RuntimeDescriptor): AsyncIterable<AppEvent>;
}

export interface ToolProvider extends NamedCapability {
  tools(): ToolDefinition[];
  execute(name: string, args: JsonValue, runtime: RuntimeDescriptor): Promise<ToolResult>;
}

export interface SyncProvider extends NamedCapability {
  connect(options: SyncConnectionOptions, runtime: RuntimeDescriptor): AsyncIterable<AppEvent>;
}

export interface AuthProvider extends NamedCapability {
  resolve(runtime: RuntimeDescriptor): Promise<AuthSession>;
}
