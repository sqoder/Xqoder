import type { McpServerManager } from './mcp.js';
import type { ToolRegistry } from './tools/tool.js';

export interface DynamicMcpToolSyncInput {
    mcpManager?: McpServerManager;
    toolRegistry: ToolRegistry;
    trackedToolNames: Set<string>;
}

export async function syncDynamicMcpTools(input: DynamicMcpToolSyncInput): Promise<void> {
    if (!input.mcpManager) {
        return;
    }

    const remoteTools = await input.mcpManager.listTools();
    const nextNames = new Set(remoteTools.map((tool) => tool.definition.name));

    for (const tool of remoteTools) {
        input.toolRegistry.upsert(tool);
    }

    for (const toolName of input.trackedToolNames) {
        if (!nextNames.has(toolName)) {
            input.toolRegistry.remove(toolName);
        }
    }

    input.trackedToolNames.clear();
    for (const toolName of nextNames) {
        input.trackedToolNames.add(toolName);
    }
}
