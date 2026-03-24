import type { RuntimeKernel } from '@xqoder/runtime';
import { definePlugin } from '@xqoder/plugin-sdk';
import { createXQoderAgentProvider, type AgentConfigResolver, type XQoderAgentProviderOptions } from '@xqoder/agent';

export interface BuiltInRuntimePluginOptions {
    resolveAgentConfig: AgentConfigResolver;
    createAgent?: XQoderAgentProviderOptions['createAgent'];
}

export function createBuiltInRuntimePlugin(options: BuiltInRuntimePluginOptions) {
    return definePlugin({
        manifest: {
            name: 'xqoder-builtins',
            version: '0.1.0',
            capabilities: ['agent-provider'],
        },
        setup(api) {
            api.registerAgentProvider(createXQoderAgentProvider(options.resolveAgentConfig, {
                name: 'xqoder-agent',
                ...(options.createAgent ? { createAgent: options.createAgent } : {}),
            }));
        },
    });
}

export async function loadBuiltInRuntimePlugins(
    runtime: RuntimeKernel,
    options: BuiltInRuntimePluginOptions,
): Promise<void> {
    await runtime.registerPlugin(createBuiltInRuntimePlugin(options));
}
