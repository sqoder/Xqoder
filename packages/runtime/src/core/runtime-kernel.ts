import { randomUUID } from 'node:crypto';
import type { PermissionPolicy, PermissionRequest } from '@xqoder/permissions';
import type { AppEvent, CoreMessage, JsonValue } from '@xqoder/protocol';
import type {
  AgentProvider,
  AgentTask,
  AuthProvider,
  CommandRegistration,
  ConfigSchemaExtension,
  ModelInput,
  ModelProvider,
  Plugin,
  PluginAPI,
  RuntimeDescriptor,
  SyncProvider,
  ToolProvider,
  ToolResult,
} from '@xqoder/plugin-sdk';
import { EventBus } from './event-bus.js';
import { NamedRegistry } from './registry.js';
import type { SessionRecord, SessionStore } from './session-store.js';

export interface RuntimeKernelOptions {
  sessionStore: SessionStore;
  permissionPolicy: PermissionPolicy;
}

export interface RuntimeSnapshot {
  commands: CommandRegistration[];
  modelProviders: string[];
  agentProviders: string[];
  toolProviders: string[];
  syncProviders: string[];
  authProviders: string[];
  configExtensions: ConfigSchemaExtension[];
}

export interface RuntimeSessionListOptions {
  projectRoot?: string;
  limit?: number;
}

export interface RuntimeSessionCreateInput {
  id?: string;
  cwd: string;
  projectRoot?: string;
  model?: string;
  title?: string;
  createdAt?: number;
}

export interface RuntimeSessionUpdateInput {
  sessionId: string;
  cwd?: string;
  title?: string;
  metadata?: Record<string, JsonValue>;
  messages?: CoreMessage[];
  updatedAt?: number;
}

export interface RuntimeSessionUpsertInput {
  sessionId: string;
  cwd: string;
  title?: string;
  metadata?: Record<string, JsonValue>;
  messages?: CoreMessage[];
  createdAt?: number;
  updatedAt?: number;
}

export type RuntimeKernelCommand =
  | {
      type: 'model.run';
      providerName: string;
      input: ModelInput;
      runtime: RuntimeDescriptor;
    }
  | {
      type: 'agent.run';
      providerName: string;
      task: AgentTask;
      runtime: RuntimeDescriptor;
    }
  | {
      type: 'tool.invoke';
      providerName: string;
      toolName: string;
      args: JsonValue;
      runtime: RuntimeDescriptor;
    }
  | {
      type: 'session.list';
      projectRoot?: string;
      limit?: number;
    }
  | {
      type: 'session.create';
      input: RuntimeSessionCreateInput;
    }
  | {
      type: 'session.update-title';
      sessionId: string;
      title: string;
    }
  | {
      type: 'session.update';
      input: RuntimeSessionUpdateInput;
    }
  | {
      type: 'session.upsert';
      input: RuntimeSessionUpsertInput;
    }
  | {
      type: 'session.append-event';
      sessionId: string;
      event: AppEvent;
    }
  | {
      type: 'session.save-snapshot';
      record: SessionRecord;
    }
  | {
      type: 'session.commit-snapshot';
      record: SessionRecord;
    }
  | {
      type: 'session.load';
      sessionId: string;
    }
  | {
      type: 'session.load-snapshot';
      sessionId: string;
    }
  | {
      type: 'kernel.snapshot';
    };

export type RuntimeKernelDispatchResult =
  | void
  | RuntimeSnapshot
  | SessionRecord[]
  | SessionRecord
  | undefined
  | ToolResult
  | AsyncIterable<AppEvent>;

export class RuntimeKernel {
  readonly events = new EventBus();

  private readonly commands: CommandRegistration[] = [];
  private readonly configExtensions: ConfigSchemaExtension[] = [];
  private readonly models = new NamedRegistry<ModelProvider>();
  private readonly agents = new NamedRegistry<AgentProvider>();
  private readonly tools = new NamedRegistry<ToolProvider>();
  private readonly syncProviders = new NamedRegistry<SyncProvider>();
  private readonly authProviders = new NamedRegistry<AuthProvider>();

  constructor(private readonly options: RuntimeKernelOptions) {}

  async registerPlugin(plugin: Plugin): Promise<void> {
    await plugin.setup(this.createPluginAPI());
  }

  snapshot(): RuntimeSnapshot {
    return {
      commands: [...this.commands],
      modelProviders: this.models.list().map((item) => item.name),
      agentProviders: this.agents.list().map((item) => item.name),
      toolProviders: this.tools.list().map((item) => item.name),
      syncProviders: this.syncProviders.list().map((item) => item.name),
      authProviders: this.authProviders.list().map((item) => item.name),
      configExtensions: [...this.configExtensions],
    };
  }

  async dispatch(command: RuntimeKernelCommand): Promise<RuntimeKernelDispatchResult> {
    switch (command.type) {
      case 'model.run':
        return this.runModel(command.providerName, command.input, command.runtime);
      case 'agent.run':
        return this.runAgent(command.providerName, command.task, command.runtime);
      case 'tool.invoke':
        return this.invokeTool(command.providerName, command.toolName, command.args, command.runtime);
      case 'session.list':
        return this.listSessions({
          projectRoot: command.projectRoot,
          limit: command.limit,
        });
      case 'session.create':
        return this.createSession(command.input);
      case 'session.update-title':
        return this.updateSessionTitle(command.sessionId, command.title);
      case 'session.update':
        return this.updateSession(command.input);
      case 'session.upsert':
        return this.upsertSession(command.input);
      case 'session.append-event':
        return this.appendSessionEvent(command.sessionId, command.event);
      case 'session.save-snapshot':
        return this.saveSessionSnapshot(command.record);
      case 'session.commit-snapshot':
        return this.saveSessionSnapshot(command.record);
      case 'session.load':
        return this.loadSessionSnapshot(command.sessionId);
      case 'session.load-snapshot':
        return this.loadSessionSnapshot(command.sessionId);
      case 'kernel.snapshot':
        return this.snapshot();
      default:
        return undefined;
    }
  }

  async emit(event: AppEvent): Promise<void> {
    await this.events.emit(event);
  }

  async *runModel(providerName: string, input: ModelInput, runtime: RuntimeDescriptor): AsyncIterable<AppEvent> {
    const provider = this.models.get(providerName);
    if (!provider) {
      throw new Error(`Unknown model provider: ${providerName}`);
    }

    yield* this.emitStream(provider.stream(input, this.attachRuntime(runtime)));
  }

  async *runAgent(providerName: string, task: AgentTask, runtime: RuntimeDescriptor): AsyncIterable<AppEvent> {
    const provider = this.agents.get(providerName);
    if (!provider) {
      throw new Error(`Unknown agent provider: ${providerName}`);
    }

    yield* this.emitStream(provider.run(task, this.attachRuntime(runtime)));
  }

  async invokeTool(providerName: string, toolName: string, args: JsonValue, runtime: RuntimeDescriptor): Promise<ToolResult> {
    const provider = this.tools.get(providerName);
    if (!provider) {
      throw new Error(`Unknown tool provider: ${providerName}`);
    }

    await this.ensureAllowed({
      kind: 'tool.use',
      target: `${providerName}:${toolName}`,
      sessionId: runtime.sessionId,
      cwd: runtime.cwd,
      payload: args,
    });

    const emitWithRuntime = async (event: AppEvent): Promise<void> => {
      await this.emit(event);
      await runtime.emit?.(event);
    };

    const calledEvent: AppEvent = {
      type: 'tool.called',
      sessionId: runtime.sessionId,
      timestamp: Date.now(),
      source: 'runtime',
      provider: providerName,
      tool: toolName,
      args,
    };
    await emitWithRuntime(calledEvent);

    try {
      const result = await provider.execute(toolName, args, this.attachRuntime(runtime));
      const outputEvent: AppEvent = {
        type: 'tool.output',
        sessionId: runtime.sessionId,
        timestamp: Date.now(),
        source: 'runtime',
        provider: providerName,
        tool: toolName,
        output: result.output,
        partial: false,
      };
      await emitWithRuntime(outputEvent);

      const completedEvent: AppEvent = {
        type: 'tool.completed',
        sessionId: runtime.sessionId,
        timestamp: Date.now(),
        source: 'runtime',
        provider: providerName,
        tool: toolName,
        success: result.success,
        ...(result.metadata ? { metadata: result.metadata } : {}),
      };
      await emitWithRuntime(completedEvent);
      return result;
    } catch (error) {
      const completedEvent: AppEvent = {
        type: 'tool.completed',
        sessionId: runtime.sessionId,
        timestamp: Date.now(),
        source: 'runtime',
        provider: providerName,
        tool: toolName,
        success: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
      await emitWithRuntime(completedEvent);
      throw error;
    }
  }

  async executeTool(providerName: string, toolName: string, args: JsonValue, runtime: RuntimeDescriptor): Promise<ToolResult> {
    return this.invokeTool(providerName, toolName, args, runtime);
  }

  async listSessions(options: RuntimeSessionListOptions = {}): Promise<SessionRecord[]> {
    const records = await this.options.sessionStore.list();
    const filtered = options.projectRoot
      ? records.filter((record) => this.readProjectRoot(record) === options.projectRoot)
      : records;
    const limit = options.limit ? Math.max(1, options.limit) : undefined;
    return limit ? filtered.slice(0, limit) : filtered;
  }

  async getLatestSession(projectRoot: string): Promise<SessionRecord | undefined> {
    return (await this.listSessions({ projectRoot, limit: 1 }))[0];
  }

  async createSession(input: RuntimeSessionCreateInput): Promise<SessionRecord> {
    const createdAt = input.createdAt ?? Date.now();
    const record: SessionRecord = {
      id: input.id ?? `session_${randomUUID()}`,
      cwd: input.cwd,
      ...(input.title ? { title: input.title } : {}),
      createdAt,
      updatedAt: createdAt,
      messages: [],
      ...((input.projectRoot || input.model)
        ? {
            metadata: {
              ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
              ...(input.model ? { model: input.model } : {}),
            },
          }
        : {}),
    };
    return this.saveSessionSnapshot(record);
  }

  async updateSession(input: RuntimeSessionUpdateInput): Promise<SessionRecord | undefined> {
    const current = await this.loadSessionSnapshot(input.sessionId);
    if (!current) {
      return undefined;
    }

    const nextUpdatedAt = Math.max(input.updatedAt ?? Date.now(), current.updatedAt);
    return this.saveSessionSnapshot({
      ...current,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.messages ? { messages: [...input.messages] } : {}),
      ...(input.metadata
        ? {
            metadata: {
              ...(current.metadata ?? {}),
              ...input.metadata,
            },
          }
        : {}),
      updatedAt: nextUpdatedAt,
    });
  }

  async upsertSession(input: RuntimeSessionUpsertInput): Promise<SessionRecord> {
    const current = await this.loadSessionSnapshot(input.sessionId);
    if (!current) {
      const createdAt = input.createdAt ?? input.updatedAt ?? Date.now();
      return this.saveSessionSnapshot({
        id: input.sessionId,
        cwd: input.cwd,
        ...(input.title ? { title: input.title } : {}),
        createdAt,
        updatedAt: Math.max(input.updatedAt ?? createdAt, createdAt),
        messages: input.messages ? [...input.messages] : [],
        ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
      });
    }

    const nextUpdatedAt = Math.max(input.updatedAt ?? Date.now(), current.updatedAt);
    return this.saveSessionSnapshot({
      ...current,
      cwd: input.cwd,
      ...(input.title ? { title: input.title } : {}),
      ...(input.messages ? { messages: [...input.messages] } : {}),
      ...(input.metadata
        ? {
            metadata: {
              ...(current.metadata ?? {}),
              ...input.metadata,
            },
          }
        : {}),
      updatedAt: nextUpdatedAt,
    });
  }

  async appendSessionMessage(sessionId: string, message: CoreMessage): Promise<SessionRecord | undefined> {
    await this.options.sessionStore.appendMessage(sessionId, message);
    return this.loadSessionSnapshot(sessionId);
  }

  async appendMessage(sessionId: string, message: CoreMessage): Promise<SessionRecord | undefined> {
    return this.appendSessionMessage(sessionId, message);
  }

  async appendSessionEvent(sessionId: string, event: AppEvent): Promise<SessionRecord | undefined> {
    const message = this.extractPersistableMessage(event);
    if (!message || message.sessionId !== sessionId) {
      return this.loadSessionSnapshot(sessionId);
    }
    return this.appendSessionMessage(sessionId, message);
  }

  async saveSessionSnapshot(record: SessionRecord): Promise<SessionRecord> {
    await this.options.sessionStore.upsert(record);
    return (await this.loadSessionSnapshot(record.id)) ?? record;
  }

  async commitSessionSnapshot(record: SessionRecord): Promise<SessionRecord> {
    return this.saveSessionSnapshot(record);
  }

  loadSessionSnapshot(sessionId: string): Promise<SessionRecord | undefined> | SessionRecord | undefined {
    return this.options.sessionStore.get(sessionId);
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<SessionRecord | undefined> {
    return this.updateSession({
      sessionId,
      title,
    });
  }

  private createPluginAPI(): PluginAPI {
    return {
      registerCommand: (command) => {
        this.commands.push(command);
      },
      registerModelProvider: (provider) => {
        this.models.register(provider);
      },
      registerAgentProvider: (provider) => {
        this.agents.register(provider);
      },
      registerToolProvider: (provider) => {
        this.tools.register(provider);
      },
      registerSyncProvider: (provider) => {
        this.syncProviders.register(provider);
      },
      registerAuthProvider: (provider) => {
        this.authProviders.register(provider);
      },
      extendConfig: (extension) => {
        this.configExtensions.push(extension);
      },
      onEvent: (type, handler) => {
        this.events.on(type, handler);
      },
    };
  }

  private attachRuntime(runtime: RuntimeDescriptor): RuntimeDescriptor {
    return {
      ...runtime,
      permissionPolicy: runtime.permissionPolicy ?? this.options.permissionPolicy,
      emit: async (event) => {
        await this.emit(event);
        await runtime.emit?.(event);
      },
    };
  }

  private async ensureAllowed(request: PermissionRequest): Promise<void> {
    const decision = await this.options.permissionPolicy.evaluate(request);
    if (decision === 'deny') {
      throw new Error(`Permission denied for ${request.kind}:${request.target}`);
    }
  }

  private async *emitStream(source: AsyncIterable<AppEvent>): AsyncIterable<AppEvent> {
    for await (const event of source) {
      await this.emit(event);
      await this.appendSessionEvent(event.sessionId, event);
      yield event;
    }
  }

  private extractPersistableMessage(event: AppEvent): CoreMessage | null {
    if (event.type !== 'message.completed') {
      return null;
    }
    return event.message;
  }

  private readProjectRoot(record: SessionRecord): string {
    const value = record.metadata?.['projectRoot'];
    return typeof value === 'string' && value.length > 0 ? value : record.cwd;
  }
}
