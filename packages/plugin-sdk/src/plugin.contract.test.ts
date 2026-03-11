import { describe, expect, it } from 'vitest';
import type { Plugin, PluginAPI } from './plugin.js';
import type { ConfigSchemaExtension, SchemaAdapter } from './schemas.js';
import { definePlugin } from './plugin.js';

function createMockPluginAPI(): PluginAPI {
  return {
    registerCommand: () => {},
    registerModelProvider: () => {},
    registerAgentProvider: () => {},
    registerToolProvider: () => {},
    registerSyncProvider: () => {},
    registerAuthProvider: () => {},
    extendConfig: () => {},
    onEvent: () => {},
  };
}

describe('plugin-sdk plugin contract', () => {
  it('Plugin has manifest and setup', () => {
    const plugin: Plugin = {
      manifest: {
        name: 'test-plugin',
        version: '1.0.0',
        capabilities: ['commands'],
        enabledByDefault: true,
        compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
      },
      setup(api: PluginAPI) {
        expect(typeof api.registerCommand).toBe('function');
        expect(typeof api.registerAgentProvider).toBe('function');
        expect(typeof api.extendConfig).toBe('function');
        expect(typeof api.onEvent).toBe('function');
      },
    };
    expect(plugin.manifest.name).toBe('test-plugin');
    plugin.setup(createMockPluginAPI());
  });

  it('definePlugin returns the same plugin', () => {
    const plugin: Plugin = {
      manifest: { name: 'p' },
      setup() {},
    };
    const wrapped = definePlugin(plugin);
    expect(wrapped).toBe(plugin);
    expect(wrapped.manifest.name).toBe('p');
  });

  it('ConfigSchemaExtension has key and schema adapter', () => {
    const adapter: SchemaAdapter<{ foo: string }> = {
      parse(input: unknown) {
        if (typeof input === 'object' && input !== null && 'foo' in input && typeof (input as { foo: unknown }).foo === 'string') {
          return { foo: (input as { foo: string }).foo };
        }
        throw new Error('invalid');
      },
      safeParse(input: unknown) {
        try {
          return { success: true as const, data: this.parse(input) };
        } catch (e) {
          return { success: false as const, error: e };
        }
      },
    };
    const ext: ConfigSchemaExtension<{ foo: string }> = {
      key: 'myPlugin',
      schema: adapter,
      description: 'My plugin config',
    };
    expect(ext.key).toBe('myPlugin');
    const result = ext.schema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.foo).toBe('bar');
  });
});
