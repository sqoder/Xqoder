import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpServerManager } from '../src/core/agent/mcp-server-manager.js';
import type { ITool, ToolContext } from '../src/core/agent/tools/tool.js';
import { resolveToolPermissionDecision } from '../src/domain/permissions/index.js';

const rootDir = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-mcp-live-smoke-'));
const serverPath = path.join(tempDir, 'stdio-fixture.mjs');
const checks: string[] = [];

try {
    fs.writeFileSync(serverPath, createFixtureServerSource(), 'utf-8');

    const manager = new McpServerManager({
        servers: [{
            name: 'live-fixture',
            transport: 'stdio',
            command: process.execPath,
            args: [serverPath],
            trust: 'untrusted',
            timeoutMs: 5_000,
        }],
        cwd: rootDir,
        projectRoot: rootDir,
        sandboxMode: 'project',
    });

    try {
        const tools = await manager.listTools();
        const remoteTool = requireTool(tools, (tool) => tool.definition.name.endsWith('.echo'), 'remote echo tool');
        const listResources = requireTool(tools, (tool) => tool.definition.name.endsWith('.resources.list'), 'resources/list tool');
        const readResource = requireTool(tools, (tool) => tool.definition.name.endsWith('.resources.read'), 'resources/read tool');
        const listPrompts = requireTool(tools, (tool) => tool.definition.name.endsWith('.prompts.list'), 'prompts/list tool');
        const getPrompt = requireTool(tools, (tool) => tool.definition.name.endsWith('.prompts.get'), 'prompts/get tool');
        checks.push('tools/list exposed remote, resources, and prompts tools');

        const context: ToolContext = {
            cwd: rootDir,
            projectRoot: rootDir,
            sandboxMode: 'project',
        };
        const securityContext = remoteTool.getSecurityPolicyContext?.();
        const approval = await remoteTool.buildApprovalRequest?.({ message: 'hello' }, context);
        const decision = resolveToolPermissionDecision({
            toolName: remoteTool.definition.name,
            args: { message: 'hello' },
            permissions: { defaultMode: 'auto', tools: {} },
            hasPriorRead: true,
            projectRoot: rootDir,
            securityContext,
        });
        assert(decision === 'ask', `expected untrusted MCP tool call to ask, got ${decision}`);
        assert(approval?.risk === 'high', `expected high-risk approval request, got ${approval?.risk ?? 'none'}`);
        checks.push('untrusted MCP tool call requires approval');

        const toolResult = await remoteTool.execute({
            toolCallId: 'mcp-live-tool-1',
            message: 'hello',
        }, context);
        assert(toolResult.success, toolResult.error ?? 'remote tool call failed');
        assert(toolResult.output.includes('echo:hello'), 'remote tool output did not include echo payload');
        checks.push('tools/call returned remote tool output');

        const resourcesResult = await listResources.execute({ toolCallId: 'mcp-live-resources-1' }, context);
        assert(resourcesResult.output.includes('fixture://readme'), 'resources/list output missing fixture resource');
        const readResult = await readResource.execute({
            toolCallId: 'mcp-live-resource-1',
            uri: 'fixture://readme',
        }, context);
        assert(readResult.output.includes('MCP live smoke resource'), 'resources/read output missing fixture content');
        checks.push('resources/list and resources/read returned fixture content');

        const promptsResult = await listPrompts.execute({ toolCallId: 'mcp-live-prompts-1' }, context);
        assert(promptsResult.output.includes('release-check'), 'prompts/list output missing release-check prompt');
        const promptResult = await getPrompt.execute({
            toolCallId: 'mcp-live-prompt-1',
            name: 'release-check',
            arguments: { phase: 'signoff' },
        }, context);
        assert(promptResult.output.includes('release-check:signoff'), 'prompts/get output missing argument projection');
        checks.push('prompts/list and prompts/get returned fixture prompt');

        process.stdout.write(`${JSON.stringify({
            status: 'pass',
            server: 'live-fixture',
            transport: 'stdio',
            checks,
        }, null, 2)}\n`);
    } finally {
        await manager.dispose();
    }
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

function requireTool(tools: ITool[], predicate: (tool: ITool) => boolean, label: string): ITool {
    const tool = tools.find(predicate);
    assert(tool, `missing ${label}`);
    return tool;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(`MCP live smoke failed: ${message}`);
    }
}

function createFixtureServerSource(): string {
    return `import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32603, message } });
}

rl.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  if (!request || typeof request !== 'object') {
    return;
  }
  if (request.method === 'notifications/initialized') {
    return;
  }
  if (request.id === undefined) {
    return;
  }

  try {
    switch (request.method) {
      case 'initialize':
        ok(request.id, {
          protocolVersion: request.params?.protocolVersion ?? '2025-11-25',
          serverInfo: { name: 'xqoder-live-smoke-fixture', version: '1.0.0' },
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          }
        });
        break;
      case 'tools/list':
        ok(request.id, {
          tools: [{
            name: 'echo',
            description: 'Echoes a message for Xqoder MCP live smoke',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Message to echo' }
              },
              required: ['message']
            }
          }]
        });
        break;
      case 'tools/call':
        ok(request.id, {
          content: [{ type: 'text', text: 'echo:' + String(request.params?.arguments?.message ?? '') }]
        });
        break;
      case 'resources/list':
        ok(request.id, {
          resources: [{
            uri: 'fixture://readme',
            name: 'README.md',
            mimeType: 'text/markdown',
            description: 'Xqoder MCP live smoke resource'
          }]
        });
        break;
      case 'resources/templates/list':
        ok(request.id, {
          resourceTemplates: [{
            uriTemplate: 'fixture://{name}',
            name: 'fixture-resource',
            mimeType: 'text/markdown'
          }]
        });
        break;
      case 'resources/read':
        ok(request.id, {
          contents: [{
            uri: request.params?.uri ?? 'fixture://readme',
            mimeType: 'text/markdown',
            text: '# MCP live smoke resource\\n\\nRead through a real stdio MCP child process.'
          }]
        });
        break;
      case 'prompts/list':
        ok(request.id, {
          prompts: [{
            name: 'release-check',
            description: 'Release signoff prompt',
            arguments: [{ name: 'phase', required: false }]
          }]
        });
        break;
      case 'prompts/get':
        ok(request.id, {
          description: 'Release signoff prompt',
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: 'release-check:' + String(request.params?.arguments?.phase ?? 'default')
            }
          }]
        });
        break;
      default:
        fail(request.id, 'Unsupported method: ' + request.method);
    }
  } catch (error) {
    fail(request.id, error instanceof Error ? error.message : String(error));
  }
});
`;
}
