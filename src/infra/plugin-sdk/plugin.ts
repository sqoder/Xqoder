import type { AppEvent } from '@xqoder/protocol';
import type { CommandRegistration } from './commands.js';
import type { AuthProvider, AgentProvider, ModelProvider, SyncProvider, ToolProvider } from './providers.js';
import type { ConfigSchemaExtension } from './schemas.js';

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  capabilities?: string[];
  enabledByDefault?: boolean;
  compatibility?: {
    product?: string;
    versionRange?: string;
  };
}

export interface PluginAPI {
  registerCommand(command: CommandRegistration): void;
  registerModelProvider(provider: ModelProvider): void;
  registerAgentProvider(provider: AgentProvider): void;
  registerToolProvider(provider: ToolProvider): void;
  registerSyncProvider(provider: SyncProvider): void;
  registerAuthProvider(provider: AuthProvider): void;
  extendConfig(extension: ConfigSchemaExtension): void;
  onEvent(type: AppEvent['type'] | '*', handler: (event: AppEvent) => void | Promise<void>): void;
}

export interface Plugin {
  manifest: PluginManifest;
  setup(api: PluginAPI): void | Promise<void>;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
