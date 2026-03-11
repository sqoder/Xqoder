import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { MCPServerConfig } from '@xqoder/shared';
import { McpServerManager, inspectMcpServers } from './mcp.js';

const tempDirs: string[] = [];

function createTempProject(): { projectRoot: string; serverConfig: MCPServerConfig } {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-mcp-'));
    tempDirs.push(projectRoot);

    const serverPath = path.join(projectRoot, 'fake-mcp-server.mjs');
    fs.writeFileSync(serverPath, `
import { createInterface } from 'node:readline';

let roots = [];
let toolMode = 'initial';
let promptMode = 'initial';
let resourceMode = 'initial';

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

function handleMessage(message) {
  if (Array.isArray(message)) {
    for (const entry of message) {
      handleMessage(entry);
    }
    return;
  }

  if (message.id === 'roots-1' && message.result && Array.isArray(message.result.roots)) {
    roots = message.result.roots;
    return;
  }

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {
          tools: {
            listChanged: true
          },
          prompts: {
            listChanged: true
          },
          resources: {
            listChanged: true,
            subscribe: false
          }
        },
        serverInfo: {
          name: 'fake-mcp',
          version: '1.0.0'
        }
      }
    });
    return;
  }

  if (message.method === 'notifications/initialized') {
    send({
      jsonrpc: '2.0',
      id: 'roots-1',
      method: 'roots/list'
    });
    return;
  }

  if (message.method === 'tools/list') {
    const tools = [{
      name: 'echo_root',
      description: 'Return the first announced root plus user text.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'text to echo'
          }
        },
        required: ['text']
      }
    }];

    if (toolMode === 'expanded') {
      tools.push({
        name: 'root_count',
        description: 'Return how many roots were announced.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      });
    }

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools
      }
    });
    return;
  }

  if (message.method === 'prompts/list') {
    const prompts = [{
      name: 'review_project',
      description: 'Generate a review prompt for a project.',
      arguments: [{
        name: 'project_name',
        description: 'project name',
        required: true
      }]
    }];

    if (promptMode === 'expanded') {
      prompts.push({
        name: 'summarize_root',
        description: 'Summarize the active project root.',
        arguments: []
      });
    }

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        prompts
      }
    });
    return;
  }

  if (message.method === 'prompts/get' && message.params?.name === 'review_project') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        description: 'Review prompt',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: \`Please review project \${message.params.arguments?.project_name ?? 'unknown'}.\`
          }
        }]
      }
    });
    promptMode = 'expanded';
    send({
      jsonrpc: '2.0',
      method: 'notifications/prompts/list_changed'
    });
    return;
  }

  if (message.method === 'prompts/get' && message.params?.name === 'summarize_root') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        description: 'Root summary prompt',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: \`Summarize \${roots[0]?.uri ?? 'missing'}.\`
          }
        }]
      }
    });
    return;
  }

  if (message.method === 'resources/list') {
    const resources = [{
      uri: 'docs://readme',
      name: 'README',
      description: 'Project readme'
    }];

    if (resourceMode === 'expanded') {
      resources.push({
        uri: 'docs://changelog',
        name: 'CHANGELOG',
        description: 'Project changelog'
      });
    }

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        resources
      }
    });
    return;
  }

  if (message.method === 'resources/templates/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        resourceTemplates: [{
          uriTemplate: 'docs://section/{name}',
          name: 'Section',
          description: 'Section resource template'
        }]
      }
    });
    return;
  }

  if (message.method === 'resources/read') {
    const uri = message.params?.uri;
    let text = 'unknown resource';

    if (uri === 'docs://readme') {
      text = \`README for root=\${roots[0]?.uri ?? 'missing'}\`;
      resourceMode = 'expanded';
      send({
        jsonrpc: '2.0',
        method: 'notifications/resources/list_changed'
      });
    } else if (uri === 'docs://changelog') {
      text = 'CHANGELOG: v1';
    } else if (typeof uri === 'string' && uri.startsWith('docs://section/')) {
      text = \`Section=\${uri.slice('docs://section/'.length)}\`;
    }

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text
        }]
      }
    });
    return;
  }

  if (message.method === 'tools/call' && message.params?.name === 'echo_root') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{
          type: 'text',
          text: \`root=\${roots[0]?.uri ?? 'missing'} text=\${message.params.arguments?.text ?? ''}\`
        }]
      }
    });
    toolMode = 'expanded';
    send({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed'
    });
    return;
  }

  if (message.method === 'tools/call' && message.params?.name === 'root_count') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{
          type: 'text',
          text: String(roots.length)
        }]
      }
    });
    return;
  }

  send({
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: -32601,
      message: 'unsupported'
    }
  });
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  handleMessage(JSON.parse(trimmed));
});
`, 'utf-8');

    return {
        projectRoot,
        serverConfig: {
            name: 'demo',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
            timeoutMs: 5_000,
        },
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('MCP bridge', () => {
    it('inspects a stdio server and reports advertised tools', async () => {
        const { projectRoot, serverConfig } = createTempProject();

        const inspections = await inspectMcpServers({
            servers: [serverConfig],
            cwd: projectRoot,
            projectRoot,
        });

        expect(inspections).toHaveLength(1);
        expect(inspections[0]).toMatchObject({
            name: 'demo',
            status: 'ok',
            protocolVersion: '2025-11-25',
            serverInfo: {
                name: 'fake-mcp',
                version: '1.0.0',
            },
            toolCount: 1,
            promptCount: 1,
            resourceCount: 1,
            resourceTemplateCount: 1,
        });
        expect(inspections[0]?.tools[0]?.name).toBe('echo_root');
        expect(inspections[0]?.prompts[0]?.name).toBe('review_project');
        expect(inspections[0]?.resources[0]?.uri).toBe('docs://readme');
        expect(inspections[0]?.resourceTemplates[0]?.uriTemplate).toBe('docs://section/{name}');
    });

    it('exposes tools, prompts and resources through the MCP bridge', async () => {
        const { projectRoot, serverConfig } = createTempProject();
        const manager = new McpServerManager({
            servers: [serverConfig],
            cwd: projectRoot,
            projectRoot,
        });

        try {
            const initialTools = await manager.listTools();
            expect(initialTools.map((tool) => tool.definition.name)).toEqual([
                'mcp.demo.echo_root',
                'mcp.demo.resources.list',
                'mcp.demo.resources.read',
                'mcp.demo.prompts.list',
                'mcp.demo.prompts.get',
            ]);

            const promptListResult = await findTool(initialTools, 'mcp.demo.prompts.list').execute({
                toolCallId: 'tool_prompt_list',
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(promptListResult.output).toContain('review_project');
            expect(promptListResult.output).toContain('project_name*');

            const promptResult = await findTool(initialTools, 'mcp.demo.prompts.get').execute({
                toolCallId: 'tool_prompt_get',
                name: 'review_project',
                arguments: {
                    project_name: 'XQoder',
                },
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(promptResult.output).toContain('Please review project XQoder.');

            const resourceListResult = await findTool(initialTools, 'mcp.demo.resources.list').execute({
                toolCallId: 'tool_resource_list',
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(resourceListResult.output).toContain('docs://readme');
            expect(resourceListResult.output).toContain('docs://section/{name}');

            const readResourceResult = await findTool(initialTools, 'mcp.demo.resources.read').execute({
                toolCallId: 'tool_resource_read',
                uri: 'docs://readme',
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(readResourceResult.output).toContain(pathToFileURL(projectRoot).toString());

            const echoResult = await findTool(initialTools, 'mcp.demo.echo_root').execute({
                toolCallId: 'tool_1',
                text: 'hello',
            }, {
                cwd: projectRoot,
                projectRoot,
            });

            expect(echoResult.success).toBe(true);
            expect(echoResult.output).toContain(pathToFileURL(projectRoot).toString());
            expect(echoResult.output).toContain('text=hello');

            const refreshedTools = await manager.listTools();
            expect(refreshedTools.map((tool) => tool.definition.name)).toEqual([
                'mcp.demo.echo_root',
                'mcp.demo.root_count',
                'mcp.demo.resources.list',
                'mcp.demo.resources.read',
                'mcp.demo.prompts.list',
                'mcp.demo.prompts.get',
            ]);

            const refreshedPromptList = await findTool(refreshedTools, 'mcp.demo.prompts.list').execute({
                toolCallId: 'tool_prompt_list_2',
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(refreshedPromptList.output).toContain('summarize_root');

            const refreshedResourceList = await findTool(refreshedTools, 'mcp.demo.resources.list').execute({
                toolCallId: 'tool_resource_list_2',
            }, {
                cwd: projectRoot,
                projectRoot,
            });
            expect(refreshedResourceList.output).toContain('docs://changelog');

            const countTool = findTool(refreshedTools, 'mcp.demo.root_count');
            const countResult = await countTool.execute({
                toolCallId: 'tool_2',
            }, {
                cwd: projectRoot,
                projectRoot,
            });

            expect(countResult.success).toBe(true);
            expect(countResult.output).toContain('1');
        } finally {
            await manager.dispose();
        }
    });
});

function findTool(
    tools: Awaited<ReturnType<McpServerManager['listTools']>>,
    name: string,
) {
    const tool = tools.find((entry) => entry.definition.name === name);
    if (!tool) {
        throw new Error(`Missing tool: ${name}`);
    }
    return tool;
}
