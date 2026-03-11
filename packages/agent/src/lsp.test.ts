import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Duplex } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalLanguageServerManager, inspectLspServers } from './lsp.js';

const tempDirs: string[] = [];

function createWorkspace(): {
    filePath: string;
    projectRoot: string;
    serverScript: string;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-ext-lsp-'));
    tempDirs.push(projectRoot);
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'app.py');

    fs.writeFileSync(filePath, [
        'def greet_user(name):',
        '    return f"Hello {name}"',
        '',
        'message = greet_user("Ada")',
        'print(greet_user("Lin"))',
        '',
    ].join('\n'), 'utf-8');

    const serverScript = path.join(projectRoot, 'fake-python-lsp.mjs');
    fs.writeFileSync(serverScript, FAKE_PYTHON_LSP_SERVER, 'utf-8');

    return {
        filePath,
        projectRoot,
        serverScript,
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

describe('external language server manager', () => {
    it('queries workspace symbols, diagnostics, definitions and references from an external LSP server', async () => {
        const workspace = createWorkspace();
        const manager = new ExternalLanguageServerManager({
            servers: [
                {
                    name: 'fake-python',
                    command: process.execPath,
                    args: [workspace.serverScript],
                    extensions: ['.py'],
                    languageId: 'python',
                    timeoutMs: 5_000,
                },
            ],
            cwd: workspace.projectRoot,
            projectRoot: workspace.projectRoot,
        });

        try {
            const symbols = await manager.listWorkspaceSymbols('greet', 10);
            expect(symbols).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'greet_user',
                    filePath: workspace.filePath,
                }),
            ]));

            const diagnostics = await manager.getFileDiagnostics(workspace.filePath);
            expect(diagnostics).toEqual([
                expect.objectContaining({
                    code: 'PY100',
                    filePath: workspace.filePath,
                    severity: 'WARNING',
                }),
            ]);

            const definitions = await manager.findDefinitions(workspace.filePath, 4, 11);
            expect(definitions).toEqual([
                expect.objectContaining({
                    filePath: workspace.filePath,
                    line: 1,
                    preview: 'def greet_user(name):',
                }),
            ]);

            const references = await manager.findReferences(workspace.filePath, 4, 11, 10);
            expect(references).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    filePath: workspace.filePath,
                    line: 1,
                }),
                expect.objectContaining({
                    filePath: workspace.filePath,
                    line: 4,
                    preview: 'message = greet_user("Ada")',
                }),
                expect.objectContaining({
                    filePath: workspace.filePath,
                    line: 5,
                    preview: 'print(greet_user("Lin"))',
                }),
            ]));

            const hover = await manager.getHover(workspace.filePath, 4, 11);
            expect(hover).toEqual(expect.objectContaining({
                contents: expect.stringContaining('def greet_user(name):'),
            }));

            const completions = await manager.getCompletions(workspace.filePath, 4, 11, 10, true, 1);
            expect(completions).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    label: 'greet_user',
                    documentation: 'resolved from completionItem/resolve',
                    resolved: true,
                }),
            ]));

            const rename = await manager.renameSymbol(workspace.filePath, 4, 11, 'welcome_user');
            expect(rename).toEqual(expect.objectContaining({
                filePaths: [workspace.filePath],
                totalEdits: 3,
            }));
        } finally {
            await manager.dispose();
        }
    });

    it('inspects stdio LSP server capabilities', async () => {
        const workspace = createWorkspace();
        const inspections = await inspectLspServers({
            servers: [
                {
                    name: 'fake-python',
                    command: process.execPath,
                    args: [workspace.serverScript],
                    extensions: ['.py'],
                    languageId: 'python',
                    timeoutMs: 5_000,
                },
            ],
            cwd: workspace.projectRoot,
            projectRoot: workspace.projectRoot,
        });

        expect(inspections).toEqual([
            expect.objectContaining({
                name: 'fake-python',
                status: 'ok',
                extensions: ['.py'],
                languageId: 'python',
                capabilities: {
                    workspaceSymbols: true,
                    definition: true,
                    references: true,
                    diagnostics: true,
                    hover: true,
                    completion: true,
                    completionResolve: true,
                    rename: true,
                },
                serverInfo: {
                    name: 'fake-python-lsp',
                    version: '1.0.0',
                },
            }),
        ]);
    });

    it('supports TCP transport and handles workspace/applyEdit requests', async () => {
        const workspace = createWorkspace();
        vi.resetModules();
        vi.doMock('node:net', () => ({
            createConnection: () => createFakeTcpSocket(workspace.projectRoot),
        }));
        const {
            ExternalLanguageServerManager: TcpLanguageServerManager,
            inspectLspServers: inspectTcpServers,
        } = await import('./lsp.js');
        const serverConfig = {
            name: 'fake-python-tcp',
            transport: 'tcp' as const,
            host: '127.0.0.1',
            port: 7658,
            extensions: ['.py'],
            languageId: 'python',
            timeoutMs: 5_000,
        };
        const manager = new TcpLanguageServerManager({
            servers: [serverConfig],
            cwd: workspace.projectRoot,
            projectRoot: workspace.projectRoot,
        });

        try {
            const hover = await manager.getHover(workspace.filePath, 4, 11);
            expect(hover).toEqual(expect.objectContaining({
                contents: expect.stringContaining('tcp hover'),
            }));

            await waitFor(() => fs.readFileSync(workspace.filePath, 'utf-8').includes('Hello from applyEdit'));

            const completions = await manager.getCompletions(workspace.filePath, 4, 11, 10, true, 1);
            expect(completions).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    label: 'greet_user',
                    documentation: 'resolved over tcp',
                    resolved: true,
                }),
            ]));

            const inspections = await inspectTcpServers({
                servers: [serverConfig],
                cwd: workspace.projectRoot,
                projectRoot: workspace.projectRoot,
            });

            expect(inspections).toEqual([
                expect.objectContaining({
                    name: 'fake-python-tcp',
                    transport: 'tcp',
                    host: '127.0.0.1',
                    port: 7658,
                    status: 'ok',
                    capabilities: expect.objectContaining({
                        hover: true,
                        completion: true,
                        completionResolve: true,
                    }),
                }),
            ]);
        } finally {
            await manager.dispose();
            vi.doUnmock('node:net');
            vi.resetModules();
        }
    });
});

const FAKE_PYTHON_LSP_SERVER = `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let rootDir = process.cwd();
let buffer = Buffer.alloc(0);

function send(message) {
  const payload = JSON.stringify(message);
  const bytes = Buffer.byteLength(payload, 'utf8');
  process.stdout.write(\`Content-Length: \${bytes}\\r\\n\\r\\n\${payload}\`);
}

function parseMessages(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      throw new Error(\`Missing Content-Length: \${header}\`);
    }

    const length = Number.parseInt(match[1] ?? '', 10);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) {
      return;
    }

    const payload = buffer.slice(start, end).toString('utf8');
    buffer = buffer.slice(end);
    handleMessage(JSON.parse(payload));
  }
}

function makeLocation(filePath, line, character) {
  return {
    uri: pathToFileURL(filePath).toString(),
    range: {
      start: { line, character },
      end: { line, character: character + 5 },
    },
  };
}

function handleMessage(message) {
  if (!message.method) {
    return;
  }

  switch (message.method) {
    case 'initialize': {
      const rootUri = message.params?.rootUri;
      if (typeof rootUri === 'string') {
        rootDir = fileURLToPath(rootUri);
      }
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            workspaceSymbolProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            diagnosticProvider: {
              interFileDependencies: false,
              workspaceDiagnostics: false,
            },
            hoverProvider: true,
            completionProvider: {
              resolveProvider: true,
              triggerCharacters: ['.'],
            },
            renameProvider: {
              prepareProvider: true,
            },
          },
          serverInfo: {
            name: 'fake-python-lsp',
            version: '1.0.0',
          },
        },
      });
      return;
    }
    case 'workspace/symbol': {
      const filePath = path.join(rootDir, 'src', 'app.py');
      const query = String(message.params?.query ?? '').toLowerCase();
      const result = query.includes('greet')
        ? [{
            name: 'greet_user',
            kind: 12,
            location: makeLocation(filePath, 0, 4),
            containerName: 'app',
          }]
        : [];
      send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    case 'textDocument/definition': {
      const filePath = path.join(rootDir, 'src', 'app.py');
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [makeLocation(filePath, 0, 4)],
      });
      return;
    }
    case 'textDocument/references': {
      const filePath = path.join(rootDir, 'src', 'app.py');
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [
          makeLocation(filePath, 0, 4),
          makeLocation(filePath, 3, 10),
          makeLocation(filePath, 4, 6),
        ],
      });
      return;
    }
    case 'textDocument/diagnostic': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          kind: 'full',
          items: [
            {
              range: {
                start: { line: 3, character: 0 },
                end: { line: 3, character: 7 },
              },
              severity: 2,
              code: 'PY100',
              message: 'sample warning',
            },
          ],
        },
      });
      return;
    }
    case 'textDocument/hover': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          contents: {
            kind: 'markdown',
            value: '\`\`\`python\\ndef greet_user(name):\\n\`\`\`\\n\\nReturn a greeting.',
          },
        },
      });
      return;
    }
    case 'textDocument/completion': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isIncomplete: false,
          items: [
            {
              label: 'greet_user',
              kind: 3,
              data: { symbol: 'greet_user' },
            },
            {
              label: 'message',
              kind: 6,
              detail: 'variable',
            },
          ],
        },
      });
      return;
    }
    case 'completionItem/resolve': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          ...message.params,
          detail: 'function',
          documentation: 'resolved from completionItem/resolve',
        },
      });
      return;
    }
    case 'textDocument/prepareRename': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          range: {
            start: { line: 3, character: 10 },
            end: { line: 3, character: 20 },
          },
          placeholder: 'greet_user',
        },
      });
      return;
    }
    case 'textDocument/rename': {
      const filePath = path.join(rootDir, 'src', 'app.py');
      const uri = pathToFileURL(filePath).toString();
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: 0, character: 4 },
                  end: { line: 0, character: 14 },
                },
                newText: 'welcome_user',
              },
              {
                range: {
                  start: { line: 3, character: 10 },
                  end: { line: 3, character: 20 },
                },
                newText: 'welcome_user',
              },
              {
                range: {
                  start: { line: 4, character: 6 },
                  end: { line: 4, character: 16 },
                },
                newText: 'welcome_user',
              },
            ],
          },
        },
      });
      return;
    }
    case 'shutdown': {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: null,
      });
      return;
    }
    case 'initialized':
    case 'textDocument/didOpen':
    case 'textDocument/didChange':
      return;
    case 'exit':
      process.exit(0);
      return;
    default:
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: \`Method not found: \${message.method}\`,
        },
      });
  }
}

process.stdin.on('data', parseMessages);
`;

function createFakeTcpSocket(projectRoot: string): Duplex {
    let rootDir = projectRoot;
    let nextRequestId = 1;
    let applyEditSent = false;
    let buffer = Buffer.alloc(0);

    const socket = new class extends Duplex {
        override _read(): void {}

        override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
            buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            try {
                while (true) {
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    if (headerEnd === -1) {
                        break;
                    }

                    const header = buffer.slice(0, headerEnd).toString('utf8');
                    const match = header.match(/Content-Length:\s*(\d+)/i);
                    if (!match) {
                        throw new Error(`Missing Content-Length: ${header}`);
                    }

                    const length = Number.parseInt(match[1] ?? '', 10);
                    const start = headerEnd + 4;
                    const end = start + length;
                    if (buffer.length < end) {
                        break;
                    }

                    const payload = buffer.slice(start, end).toString('utf8');
                    buffer = buffer.slice(end);
                    handleMessage(JSON.parse(payload) as Record<string, unknown>);
                }
                callback();
            } catch (error) {
                callback(error instanceof Error ? error : new Error(String(error)));
            }
        }

        setNoDelay(): this {
            return this;
        }
    }();

    const send = (message: Record<string, unknown>) => {
        const payload = JSON.stringify(message);
        const bytes = Buffer.byteLength(payload, 'utf8');
        socket.push(Buffer.from(`Content-Length: ${bytes}\r\n\r\n${payload}`, 'utf8'));
    };

    const sendApplyEdit = () => {
        const filePath = path.join(rootDir, 'src', 'app.py');
        const uri = pathToFileURL(filePath).toString();
        send({
            jsonrpc: '2.0',
            id: nextRequestId++,
            method: 'workspace/applyEdit',
            params: {
                edit: {
                    changes: {
                        [uri]: [
                            {
                                range: {
                                    start: { line: 1, character: 13 },
                                    end: { line: 1, character: 18 },
                                },
                                newText: 'Hello from applyEdit',
                            },
                        ],
                    },
                },
            },
        });
    };

    const handleMessage = (message: Record<string, unknown>) => {
        if (typeof message.method !== 'string') {
            return;
        }

        switch (message.method) {
            case 'initialize': {
                const rootUri = (message.params as Record<string, unknown> | undefined)?.['rootUri'];
                if (typeof rootUri === 'string') {
                    rootDir = fileURLToPath(rootUri);
                }
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        capabilities: {
                            hoverProvider: true,
                            completionProvider: {
                                resolveProvider: true,
                            },
                        },
                        serverInfo: {
                            name: 'fake-python-tcp-lsp',
                            version: '1.0.0',
                        },
                    },
                });
                return;
            }
            case 'textDocument/didOpen': {
                if (!applyEditSent) {
                    applyEditSent = true;
                    sendApplyEdit();
                }
                return;
            }
            case 'textDocument/hover': {
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        contents: {
                            kind: 'markdown',
                            value: 'tcp hover',
                        },
                    },
                });
                return;
            }
            case 'textDocument/completion': {
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        items: [
                            {
                                label: 'greet_user',
                                kind: 3,
                                data: {
                                    symbol: 'greet_user',
                                },
                            },
                        ],
                    },
                });
                return;
            }
            case 'completionItem/resolve': {
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        ...(message.params as Record<string, unknown>),
                        detail: 'function',
                        documentation: 'resolved over tcp',
                    },
                });
                return;
            }
            case 'shutdown': {
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: null,
                });
                return;
            }
            case 'initialized':
            case 'exit':
            case 'textDocument/didChange':
                return;
            default:
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${message.method}`,
                    },
                });
        }
    };

    queueMicrotask(() => {
        socket.emit('connect');
    });

    return socket;
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (assertion()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('等待条件超时');
}
