import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpServerManager } from '../src/core/agent/mcp-server-manager.js';
import type { ITool, ToolContext } from '../src/core/agent/tools/tool.js';
import { resolveToolPermissionDecision } from '../src/domain/permissions/index.js';
import type { MCPServerConfig } from '@xqoder/shared';

type Transport = 'stdio' | 'http' | 'sse';

interface TransportReport {
    status: 'pass';
    server: string;
    transport: Transport;
    checks: string[];
}

const rootDir = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-mcp-live-smoke-'));

try {
    const reports: TransportReport[] = [];
    reports.push(await runStdioSmoke());

    const httpPort = await pickFreePort();
    const httpHandle = startHttpFixtureServer(httpPort);
    try {
        reports.push(await runHttpSmoke(`http://127.0.0.1:${httpPort}/mcp`));
    } finally {
        await httpHandle.stop();
    }

    const ssePort = await pickFreePort();
    const sseHandle = startSseFixtureServer(ssePort);
    try {
        reports.push(await runSseSmoke(`http://127.0.0.1:${ssePort}/mcp`));
    } finally {
        await sseHandle.stop();
    }

    process.stdout.write(`${JSON.stringify({ status: 'pass', transports: reports }, null, 2)}\n`);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

async function runStdioSmoke(): Promise<TransportReport> {
    const serverPath = path.join(tempDir, 'stdio-fixture.mjs');
    fs.writeFileSync(serverPath, createFixtureStdioSource(), 'utf-8');

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
        const checks: string[] = [];
        const tools = await manager.listTools();
        const remoteTool = requireTool(tools, (tool) => tool.definition.name.endsWith('.echo'), 'remote echo tool');
        const listResources = requireTool(tools, (tool) => tool.definition.name.endsWith('.resources.list'), 'resources/list tool');
        const readResource = requireTool(tools, (tool) => tool.definition.name.endsWith('.resources.read'), 'resources/read tool');
        const listPrompts = requireTool(tools, (tool) => tool.definition.name.endsWith('.prompts.list'), 'prompts/list tool');
        const getPrompt = requireTool(tools, (tool) => tool.definition.name.endsWith('.prompts.get'), 'prompts/get tool');
        checks.push('tools/list exposed remote, resources, and prompts tools');

        const context: ToolContext = { cwd: rootDir, projectRoot: rootDir, sandboxMode: 'project' };
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

        const toolResult = await remoteTool.execute({ toolCallId: 'mcp-live-tool-1', message: 'hello' }, context);
        assert(toolResult.success, toolResult.error ?? 'remote tool call failed');
        assert(toolResult.output.includes('echo:hello'), 'remote tool output did not include echo payload');
        checks.push('tools/call returned remote tool output');

        const resourcesResult = await listResources.execute({ toolCallId: 'mcp-live-resources-1' }, context);
        assert(resourcesResult.output.includes('fixture://readme'), 'resources/list output missing fixture resource');
        const readResult = await readResource.execute({ toolCallId: 'mcp-live-resource-1', uri: 'fixture://readme' }, context);
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

        return { status: 'pass', server: 'live-fixture', transport: 'stdio', checks };
    } finally {
        await manager.dispose();
    }
}

async function runHttpSmoke(url: string): Promise<TransportReport> {
    return runRemoteTransportSmoke({
        server: 'live-fixture-http',
        transport: 'http',
        config: {
            name: 'live-fixture-http',
            transport: 'http',
            url,
            trust: 'trusted',
            timeoutMs: 5_000,
        },
    });
}

async function runSseSmoke(url: string): Promise<TransportReport> {
    return runRemoteTransportSmoke({
        server: 'live-fixture-sse',
        transport: 'sse',
        config: {
            name: 'live-fixture-sse',
            transport: 'sse',
            url,
            trust: 'trusted',
            timeoutMs: 5_000,
        },
    });
}

async function runRemoteTransportSmoke(args: {
    server: string;
    transport: Transport;
    config: MCPServerConfig;
}): Promise<TransportReport> {
    const manager = new McpServerManager({
        servers: [args.config],
        cwd: rootDir,
        projectRoot: rootDir,
        sandboxMode: 'project',
    });

    try {
        const checks: string[] = [];
        const tools = await manager.listTools();
        const echoTool = requireTool(tools, (tool) => tool.definition.name.endsWith('.echo'), `${args.transport} echo tool`);
        checks.push(`tools/list exposed ${args.transport} echo tool`);

        const context: ToolContext = { cwd: rootDir, projectRoot: rootDir, sandboxMode: 'project' };
        const result = await echoTool.execute({ toolCallId: `mcp-${args.transport}-1`, message: 'hello' }, context);
        assert(result.success, result.error ?? `${args.transport} echo call failed`);
        assert(result.output.includes('echo:hello'), `${args.transport} echo output missing payload`);
        checks.push(`tools/call roundtrip succeeded over ${args.transport}`);

        return { status: 'pass', server: args.server, transport: args.transport, checks };
    } finally {
        await manager.dispose();
    }
}

interface FixtureHandle {
    stop(): Promise<void>;
}

function startHttpFixtureServer(port: number): FixtureHandle {
    const server = Bun.serve({
        port,
        hostname: '127.0.0.1',
        async fetch(req) {
            if (req.method !== 'POST') {
                return new Response('', { status: 405 });
            }
            let body: Record<string, unknown> = {};
            try { body = (await req.json()) as Record<string, unknown>; } catch { return new Response('', { status: 400 }); }
            return Response.json(handleFixtureRequest(body));
        },
    });
    return {
        async stop() { server.stop(true); },
    };
}

function startSseFixtureServer(port: number): FixtureHandle {
    const encoder = new TextEncoder();
    const server = Bun.serve({
        port,
        hostname: '127.0.0.1',
        async fetch(req) {
            if (req.method !== 'POST') {
                return new Response('', { status: 405 });
            }
            let body: Record<string, unknown> = {};
            try { body = (await req.json()) as Record<string, unknown>; } catch { return new Response('', { status: 400 }); }
            const payload = handleFixtureRequest(body);
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    controller.close();
                },
            });
            return new Response(stream, {
                headers: { 'content-type': 'text/event-stream' },
            });
        },
    });
    return {
        async stop() { server.stop(true); },
    };
}

function handleFixtureRequest(body: Record<string, unknown>): Record<string, unknown> {
    const id = body['id'];
    const method = body['method'];
    if (method === 'initialize') {
        return {
            jsonrpc: '2.0', id, result: {
                protocolVersion: '2025-11-25',
                serverInfo: { name: 'xqoder-live-smoke-fixture', version: '1.0.0' },
                capabilities: { tools: { listChanged: false } },
            },
        };
    }
    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0', id, result: {
                tools: [{
                    name: 'echo',
                    description: 'Echoes a message for Xqoder MCP live smoke',
                    inputSchema: {
                        type: 'object',
                        properties: { message: { type: 'string' } },
                        required: ['message'],
                    },
                }],
            },
        };
    }
    if (method === 'tools/call') {
        const params = (body['params'] ?? {}) as { arguments?: Record<string, unknown> };
        const message = String((params.arguments ?? {})['message'] ?? '');
        return {
            jsonrpc: '2.0', id, result: {
                content: [{ type: 'text', text: `echo:${message}` }],
            },
        };
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not supported: ${String(method)}` } };
}

async function pickFreePort(): Promise<number> {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') });
    const port = server.port;
    server.stop(true);
    return port;
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

function createFixtureStdioSource(): string {
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
