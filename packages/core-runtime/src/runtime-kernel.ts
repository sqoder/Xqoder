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

  async executeTool(providerName: string, toolName: string, args: JsonValue, runtime: RuntimeDescriptor): Promise<ToolResult> {
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

    return provider.execute(toolName, args, this.attachRuntime(runtime));
  }

  async appendMessage(sessionId: string, message: CoreMessage): Promise<void> {
    await this.options.sessionStore.appendMessage(sessionId, message);
  }

  getSession(sessionId: string): Promise<SessionRecord | undefined> | SessionRecord | undefined {
    return this.options.sessionStore.get(sessionId);
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
        await this.events.emit(event);
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
      await this.events.emit(event);
      yield event;
    }
  }
}
