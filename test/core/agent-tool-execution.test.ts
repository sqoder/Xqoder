import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { ToolDefinition } from '@xqoder/shared';
import type { AgentEventEmitter } from '../../src/core/agent/agent-tool-execution.js';
import { RunCommandTool, RunShellTool } from '../../src/core/agent/tools/command-tool.js';
import { GlobFilesTool, GrepContentTool, ListFilesTool } from '../../src/core/agent/tools/discovery-tools.js';
import { ReadFileTool, SearchCodeTool } from '../../src/core/agent/tools/file-tools.js';
import type { ITool, ToolApprovalRequest } from '../../src/core/agent/tools/tool.js';
import { createExecutionHarness } from './agent-tool-execution.test-support.js';

const SAMPLE_DOCX_BASE64 = 'UEsDBBQAAAAIAHhrmVzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAeGuZXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAeGuZXHcLW/q1AAAAPwEAABEAAAB3b3JkL2RvY3VtZW50LnhtbJWPQQrCMBBF954iZG9TXYiUNkUXegE9QGxGW0hmQhKtvb1JxZ0Ibh7/M58/M3X7tIY9wIeBsOGrouQMsCM94K3h59NhueUsRIVaGUJo+ASBt3JRj5Wm7m4BI0sNGKqx4X2MrhIidD1YFQpygGl2JW9VTNbfxEheO08dhJAWWCPWZbkRVg3I5YKx1HohPWU5GycTfEaUO+N6xcyAUIvsM/1M9zW/h/hP/Kis/ZHP4n1aVp/X5QtQSwECFAMUAAAACAB4a5lc13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAHhrmVwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAHhrmVx3C1v6tQAAAD8BAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADhAgAAAAA=';

function writeDocxFixture(filePath: string): void {
    fs.writeFileSync(filePath, Buffer.from(SAMPLE_DOCX_BASE64, 'base64'));
}

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('agent tool execution helper', () => {
    it('records successful tool results and emits the tool_request -> tool_response chain', async () => {
        const emitted: string[] = [];
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-success',
            autoApproveTools: true,
            emit: ((type, data) => {
                if (type === 'tool_request') {
                    emitted.push(`request:${data.name}`);
                }
                if (type === 'tool_response') {
                    emitted.push(`response:${data.name}:${data.success}`);
                }
            }) as AgentEventEmitter,
        });

        registry.register({
            definition: {
                name: 'echo_result_tool',
                description: 'echo tool result',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => ({
                toolCallId: 'call-success-1',
                success: true,
                output: `echo:${String(args.target ?? '')}`,
            }),
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-success-1',
            name: 'echo_result_tool',
            arguments: '{"target":"file.txt"}',
        }]);

        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-success-1',
                name: 'echo_result_tool',
                success: true,
                args: {
                    target: 'file.txt',
                },
                outputPreview: 'echo:file.txt',
            },
        ]);
        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-success-1',
            content: 'echo:file.txt',
        });
        expect(emitted).toEqual([
            'request:echo_result_tool',
            'response:echo_result_tool:true',
        ]);
    });

    it('keeps tool result attachments on the model-visible tool message', async () => {
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-attachments',
            autoApproveTools: true,
        });

        registry.register({
            definition: {
                name: 'attachment_tool',
                description: 'returns a rendered attachment',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => ({
                toolCallId: 'call-attachment-1',
                success: true,
                output: 'rendered page is attached',
                attachments: [{
                    type: 'image',
                    mimeType: 'image/jpeg',
                    data: 'ZmFrZS1qcGVn',
                    fileName: 'page-1.jpg',
                }],
            }),
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-attachment-1',
            name: 'attachment_tool',
            arguments: '{}',
        }]);

        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-attachment-1',
            content: 'rendered page is attached',
            attachments: [{
                type: 'image',
                mimeType: 'image/jpeg',
                data: 'ZmFrZS1qcGVn',
                fileName: 'page-1.jpg',
            }],
        });
    });

    it('records denied approval results without executing the tool', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const emitted: string[] = [];
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-execution',
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
            emit: ((type, data) => {
                if (type === 'tool_response') {
                    emitted.push(`${data.name}:${data.success}`);
                }
            }) as AgentEventEmitter,
        });

        registry.register({
            definition: {
                name: 'approval_split_test_tool',
                description: 'test tool requiring approval',
                parameters: [],
            } satisfies ToolDefinition,
            buildApprovalRequest: async () => ({
                toolCallId: 'call-approval-1',
                toolName: 'approval_split_test_tool',
                summary: 'Run approval split test tool',
                reason: 'Exercise agent-level approval handling',
                risk: 'medium',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-approval-1',
                    success: true,
                    output: 'should not execute',
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-approval-1',
                name: 'approval_split_test_tool',
                arguments: '{"target":"file.txt"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(executed).toBe(0);
        expect(approvalRequest?.summary).toBe('Run approval split test tool');
        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-approval-1',
                name: 'approval_split_test_tool',
                success: false,
            },
        ]);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: approval_split_test_tool');
        expect(emitted).toEqual(['approval_split_test_tool:false']);
    });

    it('keeps failed tool callbacks and tool_response output aligned with the stored tool message content', async () => {
        const emittedOutputs: string[] = [];
        const callbackOutputs: string[] = [];
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-failure-parity',
            autoApproveTools: true,
            emit: ((type, data) => {
                if (type === 'tool_response') {
                    emittedOutputs.push(data.output);
                }
            }) as AgentEventEmitter,
        });

        registry.register({
            definition: {
                name: 'failing_tool',
                description: 'always fails',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => ({
                toolCallId: 'call-failure-1',
                success: false,
                output: '',
                error: 'boom',
            }),
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-failure-1',
            name: 'failing_tool',
            arguments: '{}',
        }], {
            onToolEnd: (_name, result, success) => {
                callbackOutputs.push(`${success}:${result}`);
            },
        });

        expect(session.getMessages().at(-1)?.content).toBe('Error: boom');
        expect(emittedOutputs).toEqual(['Error: boom']);
        expect(callbackOutputs).toEqual(['false:Error: boom']);
    });

    it('asks before reading a path outside the workspace', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-outside-project',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-outside-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-outside-read-1',
                name: 'read_file',
                arguments: '{"path":"../Desktop/notes.txt"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'read_file',
            summary: 'Request read outside workspace: ../Desktop/notes.txt',
            risk: 'medium',
        });
        expect(executed).toBe(0);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
    });

    it('asks for read-like tools when projectRoot or cwd is missing', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-missing-scope',
            toolContext: {
                cwd: undefined,
                projectRoot: undefined,
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'auto',
                tools: {},
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-missing-scope-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-missing-scope-read-1',
                name: 'read_file',
                arguments: '{"path":"src/index.ts"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'read_file',
            summary: 'Permission policy requires approval before running read_file',
        });
        expect(executed).toBe(0);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
    });

    it('asks before reading sensitive files inside the workspace', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-agent-tool-sensitive-read',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-sensitive-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-sensitive-read-1',
                name: 'read_file',
                arguments: '{"path":".env.local"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'read_file',
            summary: 'Request read of sensitive file: .env.local',
            risk: 'high',
        });
        expect(executed).toBe(0);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
    });

    it('asks for approval before outside-workspace read-like tools run', async () => {
        const cases = [
            {
                toolName: 'list_files',
                toolCallId: 'call-outside-list-1',
                arguments: '{"path":"../Desktop"}',
                expectedSummary: 'Request read outside workspace: ../Desktop',
            },
            {
                toolName: 'glob_files',
                toolCallId: 'call-outside-glob-1',
                arguments: '{"pattern":"*.md","path":"../Desktop"}',
                expectedSummary: 'Request read outside workspace: ../Desktop',
            },
            {
                toolName: 'search_code',
                toolCallId: 'call-outside-search-1',
                arguments: '{"pattern":"TODO","path":"../Desktop"}',
                expectedSummary: 'Request read outside workspace: ../Desktop',
            },
            {
                toolName: 'grep_content',
                toolCallId: 'call-outside-grep-1',
                arguments: '{"pattern":"TODO","path":"../Desktop"}',
                expectedSummary: 'Request read outside workspace: ../Desktop',
            },
        ] as const;

        for (const testCase of cases) {
            let executed = 0;
            let approvalRequest: ToolApprovalRequest | undefined;
            const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                sessionId: `session-${testCase.toolName}`,
                toolContext: {
                    cwd: '/workspace/project',
                    projectRoot: '/workspace/project',
                    sandboxMode: 'full-access',
                },
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' },
                },
            });

            registry.register({
                definition: {
                    name: testCase.toolName,
                    description: `${testCase.toolName} test stub`,
                    parameters: [],
                } satisfies ToolDefinition,
                execute: async () => {
                    executed += 1;
                    return {
                        toolCallId: testCase.toolCallId,
                        success: true,
                        output: `executed:${testCase.toolName}`,
                    };
                },
            } satisfies ITool);

            await executeToolCalls(
                [{
                    id: testCase.toolCallId,
                    name: testCase.toolName,
                    arguments: testCase.arguments,
                }],
                {
                    onToolApproval: async (request) => {
                        approvalRequest = request;
                        return false;
                    },
                },
            );

            expect(approvalRequest).toMatchObject({
                toolName: testCase.toolName,
                summary: testCase.expectedSummary,
                risk: 'medium',
            });
            expect(executed).toBe(0);
            expect(session.getMessages().at(-1)?.content).toContain(`Tool approval denied: ${testCase.toolName}`);
        }
    });

    it('asks before outside-workspace discovery tools read external paths', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-discovery-approval-'));
        const projectRoot = path.join(tempRoot, 'project');
        const siblingRoot = path.join(tempRoot, 'external');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(siblingRoot, { recursive: true });
        fs.writeFileSync(path.join(siblingRoot, 'notes.md'), '# TODO: follow up\n', 'utf-8');

        const cases = [
            {
                tool: new ReadFileTool(),
                toolName: 'read_file',
                toolCallId: 'call-read-approve-1',
                arguments: '{"path":"../external/notes.md"}',
                expectedSummary: 'Request read outside workspace: ../external/notes.md',
            },
            {
                tool: new ListFilesTool(),
                toolName: 'list_files',
                toolCallId: 'call-list-approve-1',
                arguments: '{"path":"../external"}',
                expectedSummary: 'Request read outside workspace: ../external',
            },
            {
                tool: new GlobFilesTool(),
                toolName: 'glob_files',
                toolCallId: 'call-glob-approve-1',
                arguments: '{"pattern":"*.md","path":"../external"}',
                expectedSummary: 'Request read outside workspace: ../external',
            },
            {
                tool: new GrepContentTool(),
                toolName: 'grep_content',
                toolCallId: 'call-grep-approve-1',
                arguments: '{"pattern":"TODO","path":"../external"}',
                expectedSummary: 'Request read outside workspace: ../external',
            },
            {
                tool: new SearchCodeTool(),
                toolName: 'search_code',
                toolCallId: 'call-search-approve-1',
                arguments: '{"pattern":"TODO","path":"../external"}',
                expectedSummary: 'Request read outside workspace: ../external',
            },
        ] as const;

        try {
            for (const testCase of cases) {
                let approvalRequest: ToolApprovalRequest | undefined;
                const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                    sessionId: `session-${testCase.toolName}-approve`,
                    toolContext: {
                        cwd: projectRoot,
                        projectRoot,
                        sandboxMode: 'project',
                    },
                    permissions: {
                        defaultMode: 'allow',
                        tools: { read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' },
                    },
                });

                registry.register(testCase.tool);

                await executeToolCalls(
                    [{
                        id: testCase.toolCallId,
                        name: testCase.toolName,
                        arguments: testCase.arguments,
                    }],
                    {
                        onToolApproval: async (request) => {
                            approvalRequest = request;
                            return false;
                        },
                    },
                );

                expect(approvalRequest).toMatchObject({
                    toolName: testCase.toolName,
                    summary: testCase.expectedSummary,
                });
                expect(session.getToolHistory().at(-1)).toMatchObject({
                    id: testCase.toolCallId,
                    name: testCase.toolName,
                    success: false,
                });
                expect(session.getMessages().at(-1)?.content).toContain(`Tool approval denied: ${testCase.toolName}`);
            }
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('retries approved outside-workspace reads with a narrow approved path instead of full-access', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-discovery-approved-read-'));
        const projectRoot = path.join(tempRoot, 'project');
        const siblingRoot = path.join(tempRoot, 'external');
        const siblingFile = path.join(siblingRoot, 'notes.md');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(siblingRoot, { recursive: true });
        fs.writeFileSync(siblingFile, '# TODO: follow up\n', 'utf-8');

        try {
            const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                sessionId: 'session-approved-outside-read',
                toolContext: {
                    cwd: projectRoot,
                    projectRoot,
                    sandboxMode: 'project',
                },
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
            });

            registry.register(new ReadFileTool());

            let approvalCount = 0;
            await executeToolCalls(
                [{
                    id: 'call-approved-outside-read-1',
                    name: 'read_file',
                    arguments: '{"path":"../external/notes.md"}',
                }],
                {
                    onToolApproval: async () => {
                        approvalCount += 1;
                        return true;
                    },
                },
            );

            expect(approvalCount).toBe(1);
            expect(session.getToolHistory().at(-1)).toMatchObject({
                id: 'call-approved-outside-read-1',
                name: 'read_file',
                success: true,
            });
            expect(session.getMessages().at(-1)?.content).toContain('# TODO: follow up');
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('reuses a session read grant when the same outside file is read again', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-discovery-approved-repeat-'));
        const projectRoot = path.join(tempRoot, 'project');
        const siblingRoot = path.join(tempRoot, 'external');
        const siblingFile = path.join(siblingRoot, 'notes.md');
        const approvedReadPaths: string[] = [];
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(siblingRoot, { recursive: true });
        fs.writeFileSync(siblingFile, 'first line\nsecond line\n', 'utf-8');

        try {
            const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                sessionId: 'session-approved-repeat-read',
                toolContext: {
                    cwd: projectRoot,
                    projectRoot,
                    sandboxMode: 'project',
                    approvedReadPaths,
                },
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
            });

            registry.register(new ReadFileTool());

            let approvalCount = 0;
            await executeToolCalls(
                [{
                    id: 'call-approved-repeat-read-1',
                    name: 'read_file',
                    arguments: '{"path":"../external/notes.md"}',
                }],
                {
                    onToolApproval: async () => {
                        approvalCount += 1;
                        return true;
                    },
                },
            );

            await executeToolCalls(
                [{
                    id: 'call-approved-repeat-read-2',
                    name: 'read_file',
                    arguments: '{"path":"../external/notes.md","startLine":2,"endLine":2}',
                }],
                {
                    onToolApproval: async () => {
                        approvalCount += 1;
                        return false;
                    },
                },
            );

            expect(approvalCount).toBe(1);
            expect(approvedReadPaths).toContain(siblingFile);
            expect(session.getToolHistory().at(-1)).toMatchObject({
                id: 'call-approved-repeat-read-2',
                name: 'read_file',
                success: true,
            });
            expect(session.getMessages().at(-1)?.content).toBe('second line');
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('retries approved outside-workspace docx reads and returns extracted text', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-discovery-approved-docx-'));
        const projectRoot = path.join(tempRoot, 'project');
        const siblingRoot = path.join(tempRoot, 'external');
        const siblingFile = path.join(siblingRoot, 'report.docx');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(siblingRoot, { recursive: true });
        writeDocxFixture(siblingFile);

        try {
            const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                sessionId: 'session-approved-outside-docx-read',
                toolContext: {
                    cwd: projectRoot,
                    projectRoot,
                    sandboxMode: 'project',
                },
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
            });

            registry.register(new ReadFileTool());

            let approvalCount = 0;
            await executeToolCalls(
                [{
                    id: 'call-approved-outside-docx-read-1',
                    name: 'read_file',
                    arguments: '{"path":"../external/report.docx"}',
                }],
                {
                    onToolApproval: async () => {
                        approvalCount += 1;
                        return true;
                    },
                },
            );

            expect(approvalCount).toBe(1);
            expect(session.getToolHistory().at(-1)).toMatchObject({
                id: 'call-approved-outside-docx-read-1',
                name: 'read_file',
                success: true,
            });
            expect(session.getMessages().at(-1)?.content).toContain('Alpha line');
            expect(session.getMessages().at(-1)?.content).toContain('Gamma line');
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    it('asks for sensitive project reads before read_file runs', async () => {
        const cases = [
            { path: '.env.local', summary: 'Request read of sensitive file: .env.local' },
            { path: '.xqoder/config.json', summary: 'Request read of sensitive file: .xqoder/config.json' },
            { path: '.omc/config.json', summary: 'Request read of sensitive file: .omc/config.json' },
        ] as const;

        for (const testCase of cases) {
            let executed = 0;
            let approvalRequest: ToolApprovalRequest | undefined;
            const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
                sessionId: `session-${testCase.path}`,
                toolContext: {
                    cwd: '/workspace/project',
                    projectRoot: '/workspace/project',
                    sandboxMode: 'full-access',
                },
                permissions: {
                    defaultMode: 'allow',
                    tools: { read: 'allow' },
                },
            });

            registry.register({
                definition: {
                    name: 'read_file',
                    description: 'read a file',
                    parameters: [],
                } satisfies ToolDefinition,
                execute: async (args) => {
                    executed += 1;
                    return {
                        toolCallId: `call-${testCase.path}`,
                        success: true,
                        output: `read:${String(args.path ?? '')}`,
                    };
                },
            } satisfies ITool);

            await executeToolCalls(
                [{
                    id: `call-${testCase.path}`,
                    name: 'read_file',
                    arguments: JSON.stringify({ path: testCase.path }),
                }],
                {
                    onToolApproval: async (request) => {
                        approvalRequest = request;
                        return false;
                    },
                },
            );

            expect(approvalRequest).toMatchObject({
                toolName: 'read_file',
                summary: testCase.summary,
                risk: 'high',
            });
            expect(executed).toBe(0);
            expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: read_file');
        }
    });

    it('keeps regular project config reads approval-free', async () => {
        let executed = 0;
        let approvalRequests = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-regular-config-read',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-regular-config-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-regular-config-read-1',
                name: 'read_file',
                arguments: '{"path":"src/config.json"}',
            }],
            {
                onToolApproval: async () => {
                    approvalRequests += 1;
                    return false;
                },
            },
        );

        expect(approvalRequests).toBe(0);
        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)?.content).toContain('read:src/config.json');
    });

    it('keeps allowed-path reads approval-free', async () => {
        let executed = 0;
        let approvalRequests = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-allowed-path-read',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                allowedPaths: ['/allowed'],
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-allowed-path-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-allowed-path-read-1',
                name: 'read_file',
                arguments: '{"path":"/allowed/notes.md"}',
            }],
            {
                onToolApproval: async () => {
                    approvalRequests += 1;
                    return false;
                },
            },
        );

        expect(approvalRequests).toBe(0);
        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)?.content).toContain('read:/allowed/notes.md');
    });

    it('keeps internal runtime reads approval-free under .claude', async () => {
        let executed = 0;
        let approvalRequests = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-internal-runtime-read',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'read_file',
                description: 'read a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-internal-runtime-read-1',
                    success: true,
                    output: `read:${String(args.path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-internal-runtime-read-1',
                name: 'read_file',
                arguments: '{"path":".claude/settings.json"}',
            }],
            {
                onToolApproval: async () => {
                    approvalRequests += 1;
                    return false;
                },
            },
        );

        expect(approvalRequests).toBe(0);
        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)?.content).toContain('read:.claude/settings.json');
    });

    it('asks for file_path-based read tools that target outside-workspace files', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-diagnostics-outside-project',
            toolContext: {
                cwd: '/workspace/project',
                projectRoot: '/workspace/project',
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { lsp: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'diagnostics',
                description: 'diagnostics test stub',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async (args) => {
                executed += 1;
                return {
                    toolCallId: 'call-outside-diagnostics-1',
                    success: true,
                    output: `diagnostics:${String(args.file_path ?? '')}`,
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-outside-diagnostics-1',
                name: 'diagnostics',
                arguments: '{"file_path":"../Desktop/notes.ts"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'diagnostics',
            summary: 'Request read outside workspace: ../Desktop/notes.ts',
            risk: 'medium',
        });
        expect(executed).toBe(0);
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: diagnostics');
    });

    it('forces interactive approval before run_command uses an outside-project cwd', async () => {
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-run-command-outside-project',
            toolContext: {
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
        });

        registry.register(new RunCommandTool());

        await executeToolCalls(
            [{
                id: 'call-outside-cwd-1',
                name: 'run_command',
                arguments: '{"command":"pwd","cwd":"../Desktop"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'run_command',
            summary: 'Request access to path outside project: ../Desktop',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: run_command');
    });

    it('forces interactive approval before run_shell uses an outside-project cwd', async () => {
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-run-shell-outside-project',
            toolContext: {
                sandboxMode: 'full-access',
            },
            permissions: {
                defaultMode: 'allow',
                tools: { bash: 'allow' },
            },
        });

        registry.register(new RunShellTool());

        await executeToolCalls(
            [{
                id: 'call-outside-shell-cwd-1',
                name: 'run_shell',
                arguments: '{"command":"pwd","cwd":"../Desktop"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(approvalRequest).toMatchObject({
            toolName: 'run_shell',
            summary: 'Request access to path outside project: ../Desktop',
            risk: 'high',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: run_shell');
    });

    it('turns ask-mode into a real approval gate even for tools without native approval requests', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-generic-ask-policy',
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
        });

        registry.register({
            definition: {
                name: 'delegate_task',
                description: 'delegate a task',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-generic-ask-1',
                    success: true,
                    output: 'delegated',
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-generic-ask-1',
                name: 'delegate_task',
                arguments: '{"task":"Inspect the routing layer"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(executed).toBe(0);
        expect(approvalRequest).toMatchObject({
            toolName: 'delegate_task',
            summary: 'Permission policy requires approval before running delegate_task',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: delegate_task');
    });

    it('keeps MCP read-only tools available in plan capability', async () => {
        let executed = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-plan-mcp-readonly-tool',
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
            executionCapability: 'plan',
        });

        registry.register({
            definition: {
                name: 'mcp.docs.resources.list',
                description: 'list MCP resources',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'list_resources',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-plan-mcp-read-1',
                    success: true,
                    output: 'Resource: README.md',
                };
            },
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-plan-mcp-read-1',
            name: 'mcp.docs.resources.list',
            arguments: '{}',
        }]);

        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-plan-mcp-read-1',
            content: 'Resource: README.md',
        });
    });

    it('forces interactive approval for untrusted MCP reads even when auto-approve and read permissions are enabled', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-untrusted-mcp-read',
            autoApproveTools: true,
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'mcp.remote-docs.resources.read',
                description: 'read remote MCP resource',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'untrusted',
                serverName: 'remote-docs',
                operation: 'read_resource',
            }),
            buildApprovalRequest: () => ({
                toolCallId: '',
                toolName: 'mcp.remote-docs.resources.read',
                summary: 'Read MCP resource @ remote-docs',
                risk: 'low',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-untrusted-mcp-read-1',
                    success: true,
                    output: 'should not execute',
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-untrusted-mcp-read-1',
                name: 'mcp.remote-docs.resources.read',
                arguments: '{"uri":"file://README.md"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(executed).toBe(0);
        expect(approvalRequest).toMatchObject({
            toolName: 'mcp.remote-docs.resources.read',
            summary: 'Read MCP resource @ remote-docs',
            risk: 'high',
        });
        expect(approvalRequest?.reason).toContain('untrusted MCP server');
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: mcp.remote-docs.resources.read');
    });

    it('blocks hidden write tools before approval policy evaluation in plan capability', async () => {
        let executed = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-plan-hidden-tool',
            executionCapability: 'plan',
        });

        registry.register({
            definition: {
                name: 'write_file',
                description: 'write a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-hidden-write-1',
                    success: true,
                    output: 'should not run',
                };
            },
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-hidden-write-1',
            name: 'write_file',
            arguments: '{"path":"notes.txt","content":"hello"}',
        }]);

        expect(executed).toBe(0);
        expect(session.getMessages().at(-1)?.content).toContain('Error: Tool "write_file" is not available in the current execution capability (plan)');
    });

    it('turns ask-mode into a real approval gate even for tools without native approval requests', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-generic-ask-policy',
            permissions: {
                defaultMode: 'ask',
                tools: {},
            },
        });

        registry.register({
            definition: {
                name: 'delegate_task',
                description: 'delegate a task',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-generic-ask-1',
                    success: true,
                    output: 'delegated',
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-generic-ask-1',
                name: 'delegate_task',
                arguments: '{"task":"Inspect the routing layer"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(executed).toBe(0);
        expect(approvalRequest).toMatchObject({
            toolName: 'delegate_task',
            summary: 'Permission policy requires approval before running delegate_task',
        });
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: delegate_task');
    });

    it('keeps MCP read-only tools available in plan capability', async () => {
        let executed = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-plan-mcp-readonly-tool',
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
            executionCapability: 'plan',
        });

        registry.register({
            definition: {
                name: 'mcp.docs.resources.list',
                description: 'list MCP resources',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'trusted',
                serverName: 'docs',
                operation: 'list_resources',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-plan-mcp-read-1',
                    success: true,
                    output: 'Resource: README.md',
                };
            },
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-plan-mcp-read-1',
            name: 'mcp.docs.resources.list',
            arguments: '{}',
        }]);

        expect(executed).toBe(1);
        expect(session.getMessages().at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'call-plan-mcp-read-1',
            content: 'Resource: README.md',
        });
    });

    it('forces interactive approval for untrusted MCP reads even when auto-approve and read permissions are enabled', async () => {
        let executed = 0;
        let approvalRequest: ToolApprovalRequest | undefined;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-untrusted-mcp-read',
            autoApproveTools: true,
            permissions: {
                defaultMode: 'allow',
                tools: { read: 'allow' },
            },
        });

        registry.register({
            definition: {
                name: 'mcp.remote-docs.resources.read',
                description: 'read remote MCP resource',
                parameters: [],
            } satisfies ToolDefinition,
            getSecurityPolicyContext: () => ({
                source: 'mcp',
                trust: 'untrusted',
                serverName: 'remote-docs',
                operation: 'read_resource',
            }),
            buildApprovalRequest: () => ({
                toolCallId: '',
                toolName: 'mcp.remote-docs.resources.read',
                summary: 'Read MCP resource @ remote-docs',
                risk: 'low',
            }),
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-untrusted-mcp-read-1',
                    success: true,
                    output: 'should not execute',
                };
            },
        } satisfies ITool);

        await executeToolCalls(
            [{
                id: 'call-untrusted-mcp-read-1',
                name: 'mcp.remote-docs.resources.read',
                arguments: '{"uri":"file://README.md"}',
            }],
            {
                onToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
        );

        expect(executed).toBe(0);
        expect(approvalRequest).toMatchObject({
            toolName: 'mcp.remote-docs.resources.read',
            summary: 'Read MCP resource @ remote-docs',
            risk: 'high',
        });
        expect(approvalRequest?.reason).toContain('untrusted MCP server');
        expect(session.getMessages().at(-1)?.content).toContain('Tool approval denied: mcp.remote-docs.resources.read');
    });

    it('blocks hidden write tools before approval policy evaluation in plan capability', async () => {
        let executed = 0;
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-plan-hidden-tool',
            executionCapability: 'plan',
        });

        registry.register({
            definition: {
                name: 'write_file',
                description: 'write a file',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => {
                executed += 1;
                return {
                    toolCallId: 'call-hidden-write-1',
                    success: true,
                    output: 'should not run',
                };
            },
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-hidden-write-1',
            name: 'write_file',
            arguments: '{"path":"src/app.ts","content":"patched"}',
        }]);

        expect(executed).toBe(0);
        expect(session.getToolHistory()).toMatchObject([
            {
                id: 'call-hidden-write-1',
                name: 'write_file',
                success: false,
            },
        ]);
        expect(session.getMessages().at(-1)?.content).toContain(
            'Tool "write_file" is not available in the current execution capability (plan)',
        );
    });

    it('persists large non-read tool output and keeps only a preview in model-visible surfaces', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-large-tool-output-'));
        tempDirs.push(projectRoot);
        const { toolRegistry: registry, session, executeToolCalls } = createExecutionHarness({
            sessionId: 'session-large-output',
            autoApproveTools: true,
            toolContext: {
                cwd: projectRoot,
                projectRoot,
            },
        });
        const largeOutput = `start\n${'z'.repeat(55_000)}\nend`;

        registry.register({
            definition: {
                name: 'large_output_tool',
                description: 'returns a large output',
                parameters: [],
            } satisfies ToolDefinition,
            execute: async () => ({
                toolCallId: 'call-large-output',
                success: true,
                output: largeOutput,
            }),
        } satisfies ITool);

        await executeToolCalls([{
            id: 'call-large-output',
            name: 'large_output_tool',
            arguments: '{}',
        }]);

        const message = session.getMessages().at(-1);
        expect(message?.content).toContain('<persisted-output');
        expect(message?.content).toContain('preview_chars=');
        expect(String(message?.content ?? '').length).toBeLessThan(10_000);
        const historyEntry = session.getToolHistory().at(-1);
        expect(historyEntry?.metadata).toMatchObject({
            originalOutputChars: largeOutput.length,
            previewedOutputChars: expect.any(Number),
        });
        const persistedPath = historyEntry?.metadata?.['persistedOutputPath'];
        expect(typeof persistedPath).toBe('string');
        expect(fs.readFileSync(String(persistedPath), 'utf-8')).toBe(largeOutput);
    });
});
