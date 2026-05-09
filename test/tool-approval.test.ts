import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { SandboxAccessError } from '../src/core/agent/tools/sandbox.js';
import { RunShellTool } from '../src/core/agent/tools/command-tool.js';
import { WriteFileTool } from '../src/core/agent/tools/file-tools.js';
import { ToolRegistry, type ITool, type ToolContext, type ToolApprovalRequest } from '../src/core/agent/tools/tool.js';
import { describeApprovalRequest } from '../src/ux/tool-approval.js';

function approvalRequest(overrides: Partial<ToolApprovalRequest>): ToolApprovalRequest {
    return {
        toolCallId: 'call-approval',
        toolName: 'test_tool',
        summary: 'Manual approval required',
        risk: 'medium',
        ...overrides,
    };
}

function approvalTitle(overrides: Partial<ToolApprovalRequest>): string {
    return describeApprovalRequest(approvalRequest(overrides)).title;
}

function approvalRiskLabel(overrides: Partial<ToolApprovalRequest>): string | undefined {
    return describeApprovalRequest(approvalRequest(overrides)).riskLabel;
}


describe('tool approval flow', () => {
    it('renders CLI approval titles for outside-workspace and sensitive reads', () => {
        expect(approvalTitle({
            toolName: 'read_file',
            summary: 'Request read outside workspace: ../Desktop/notes.txt',
            risk: 'medium',
        })).toBe('Read outside workspace');

        expect(approvalTitle({
            toolName: 'read_file',
            summary: 'Request read of sensitive file: .env.local',
            risk: 'high',
        })).toBe('Sensitive read');
    });

    it('renders CLI approval titles for protected paths and high-risk writes', () => {
        expect(approvalTitle({
            toolName: 'write_file',
            summary: 'Request write to protected path: .git/config',
            risk: 'high',
        })).toBe('Protected path access');

        expect(approvalTitle({
            toolName: 'write_file',
            summary: 'Create new file',
            reason: 'This is a high-risk config path and requires approval.',
            risk: 'high',
        })).toBe('High-risk write');
    });

    it('renders CLI approval titles for shell, network, and MCP requests', () => {
        expect(approvalTitle({
            toolName: 'run_shell',
            summary: 'Execute command: rm -rf ./tmp-cache',
            risk: 'high',
        })).toBe('Shell command approval');

        expect(approvalTitle({
            toolName: 'fetch_url',
            summary: 'Fetch https://example.com',
            risk: 'medium',
        })).toBe('Network access');

        expect(approvalTitle({
            toolName: 'mcp.remote-docs.resources.read',
            summary: 'Read MCP resource @ remote-docs',
            reason: 'This operation comes from an untrusted MCP server.',
            risk: 'high',
        })).toBe('External tool access');
    });

    it('prefers structured approval categories and suggestions when present', () => {
        const details = describeApprovalRequest(approvalRequest({
            toolName: 'read_file',
            category: 'suspicious-path',
            summary: 'Request access to suspicious path: ~/.ssh/config',
            suggestion: 'Add the containing directory to allowed read paths if this access should be routine.',
            risk: 'high',
        }));

        expect(details.title).toBe('Suspicious path access');
        expect(details.riskLabel).toBe('high');
        expect(details.explanation).toContain('suspicious pattern');
        expect(details.suggestion).toContain('allowed read paths');
    });

    it('renders a stable explanation for outside-workspace reads', () => {
        const details = describeApprovalRequest(approvalRequest({
            toolName: 'read_file',
            category: 'outside-workspace-read',
            summary: 'Request read outside workspace: ../Desktop/notes.txt',
            risk: 'medium',
        }));

        expect(details.title).toBe('Read outside workspace');
        expect(details.explanation).toContain('beyond the current workspace');
    });

    it('keeps legacy text classification as a fallback when category is absent', () => {
        expect(approvalTitle({
            toolName: 'read_file',
            summary: 'Request access to suspicious path: ~/.ssh/config',
            risk: 'high',
        })).toBe('Suspicious path access');
    });

    it('renders CLI approval risk labels directly from request risk', () => {
        expect(approvalRiskLabel({ risk: 'high' })).toBe('high');
        expect(approvalRiskLabel({ risk: 'medium' })).toBe('medium');
        expect(approvalRiskLabel({ risk: 'low' })).toBe('low');
    });

    it('falls back to the manual approval title for uncategorized requests', () => {
        expect(approvalTitle({
            toolName: 'delegate_task',
            summary: 'Permission policy requires approval before running delegate_task',
            risk: 'medium',
        })).toBe('Manual approval required');
    });

    it('forces approval when a hook patch marks the request as required', async () => {
        const registry = new ToolRegistry();
        let approvalRequest: ToolApprovalRequest | undefined;
        let executed = 0;

        registry.register(createTestTool('approval_test_tool', async () => {
            executed += 1;
            return {
                toolCallId: 'call-1',
                success: true,
                output: 'ok',
            };
        }));

        const result = await registry.execute(
            'approval_test_tool',
            { target: 'file.txt' },
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                approvalRequestPatch: {
                    force: true,
                    summary: 'Hook requires approval before running approval_test_tool',
                    reason: 'Hook requested manual review.',
                    risk: 'high',
                },
                requestToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
            'call-1',
        );

        expect(executed).toBe(0);
        expect(approvalRequest?.summary).toBe('Hook requires approval before running approval_test_tool');
        expect(approvalRequest?.reason).toContain('Hook requested manual review.');
        expect(approvalRequest?.risk).toBe('high');
        expect(result.error).toBe('Tool approval denied: approval_test_tool');
    });

    it('merges hook feedback into an existing approval request', async () => {
        const registry = new ToolRegistry();
        let approvalRequest: ToolApprovalRequest | undefined;

        registry.register({
            definition: {
                name: 'approval_test_tool',
                description: 'test tool',
                parameters: [],
            } satisfies ToolDefinition,
            buildApprovalRequest: async () => ({
                toolCallId: 'call-2',
                toolName: 'approval_test_tool',
                summary: 'Base approval summary',
                reason: 'Base reason',
                preview: 'Base preview',
                risk: 'medium',
            }),
            execute: async () => ({
                toolCallId: 'call-2',
                success: true,
                output: 'executed',
            }),
        } satisfies ITool);

        const result = await registry.execute(
            'approval_test_tool',
            { target: 'file.txt' },
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                approvalRequestPatch: {
                    reason: 'Hook reason',
                    preview: 'Hook preview',
                    risk: 'high',
                },
                requestToolApproval: async (request) => {
                    approvalRequest = request;
                    return true;
                },
            },
            'call-2',
        );

        expect(result.success).toBe(true);
        expect(approvalRequest?.summary).toBe('Base approval summary');
        expect(approvalRequest?.reason).toBe('Base reason\n\nHook reason');
        expect(approvalRequest?.preview).toBe('Base preview\n\nHook preview');
        expect(approvalRequest?.risk).toBe('high');
    });

    it('requires approval before executing high-risk shell commands', async () => {
        const registry = new ToolRegistry();
        registry.register(new RunShellTool());
        let approvalRequest: ToolApprovalRequest | undefined;

        const result = await registry.execute(
            'run_shell',
            { command: 'rm -rf ./tmp-cache' },
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                requestToolApproval: async (request) => {
                    approvalRequest = request;
                    return false;
                },
            },
            'call-shell-1',
        );

        expect(approvalRequest?.summary).toContain('Execute command: rm -rf ./tmp-cache');
        expect(approvalRequest?.risk).toBe('high');
        expect(result.error).toBe('Tool approval denied: run_shell');
    });

    it('requires approval before writing high-risk config files', async () => {
        const registry = new ToolRegistry();
        registry.register(new WriteFileTool());
        let approvalRequest: ToolApprovalRequest | undefined;
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-approval-'));

        try {
            const result = await registry.execute(
                'write_file',
                {
                    path: '.env',
                    content: 'OPENAI_API_KEY=test\n',
                },
                {
                    cwd,
                    projectRoot: cwd,
                    requestToolApproval: async (request) => {
                        approvalRequest = request;
                        return false;
                    },
                },
                'call-write-1',
            );

            expect(approvalRequest?.summary).toContain('Create new file');
            expect(approvalRequest?.reason).toContain('high-risk');
            expect(approvalRequest?.risk).toBe('high');
            expect(result.error).toBe('Tool approval denied: write_file');
            expect(fs.existsSync(path.join(cwd, '.env'))).toBe(false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('honors protected-path approval patches before writing files', async () => {
        const registry = new ToolRegistry();
        registry.register(new WriteFileTool());
        let approvalRequest: ToolApprovalRequest | undefined;
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-protected-write-'));

        try {
            const result = await registry.execute(
                'write_file',
                {
                    path: '.git/config',
                    content: '[core]\n\trepositoryformatversion = 0\n',
                },
                {
                    cwd,
                    projectRoot: cwd,
                    approvalRequestPatch: {
                        force: true,
                        summary: 'Request write to protected path: .git/config',
                        reason: 'Writes to version-control metadata, local credentials, shell startup files, or agent configuration require explicit approval.',
                        risk: 'high',
                    },
                    requestToolApproval: async (request) => {
                        approvalRequest = request;
                        return false;
                    },
                },
                'call-write-protected-1',
            );

            expect(approvalRequest?.summary).toBe('Request write to protected path: .git/config');
            expect(approvalRequest?.reason).toContain('version-control metadata');
            expect(approvalRequest?.risk).toBe('high');
            expect(result.error).toBe('Tool approval denied: write_file');
            expect(fs.existsSync(path.join(cwd, '.git', 'config'))).toBe(false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('rejects forbidden destructive shell commands even after approval is granted', async () => {
        const registry = new ToolRegistry();
        registry.register(new RunShellTool());
        let approvals = 0;

        const resetResult = await registry.execute(
            'run_shell',
            { command: 'git reset --hard' },
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                requestToolApproval: async () => {
                    approvals += 1;
                    return true;
                },
            },
            'call-shell-forbidden-1',
        );

        const cleanResult = await registry.execute(
            'run_shell',
            { command: 'git clean -xdf' },
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                requestToolApproval: async () => {
                    approvals += 1;
                    return true;
                },
            },
            'call-shell-forbidden-2',
        );

        expect(approvals).toBe(2);
        expect(resetResult.success).toBe(false);
        expect(resetResult.error).toBe('Command rejected by sandbox: git reset --hard');
        expect(cleanResult.success).toBe(false);
        expect(cleanResult.error).toBe('Command rejected by sandbox: git clean -xdf');
    });

    it('requests a second approval before sandbox escalation when the first approval did not cover outside-project access', async () => {
        const registry = new ToolRegistry();
        const approvals: ToolApprovalRequest[] = [];
        let executionCount = 0;

        registry.register({
            definition: {
                name: 'outside_project_test_tool',
                description: 'test outside-project escalation approvals',
                parameters: [],
            } satisfies ToolDefinition,
            buildApprovalRequest: async () => ({
                toolCallId: '',
                toolName: 'outside_project_test_tool',
                summary: 'Run privileged maintenance action',
                reason: 'Needs confirmation before performing a risky operation.',
                risk: 'high',
            }),
            execute: async (_args, context) => {
                executionCount += 1;
                if (context.sandboxMode !== 'full-access') {
                    throw new SandboxAccessError('../Desktop/notes.txt', '/tmp/Desktop/notes.txt', 'project');
                }

                return {
                    toolCallId: 'call-sandbox-escalation-1',
                    success: true,
                    output: 'ok',
                };
            },
        } satisfies ITool);

        const result = await registry.execute(
            'outside_project_test_tool',
            {},
            {
                cwd: '/tmp/project',
                projectRoot: '/tmp/project',
                requestToolApproval: async (request) => {
                    approvals.push(request);
                    return true;
                },
            },
            'call-sandbox-escalation-1',
        );

        expect(result.success).toBe(true);
        expect(executionCount).toBe(2);
        expect(approvals).toHaveLength(2);
        expect(approvals[0]).toMatchObject({
            summary: 'Run privileged maintenance action',
            toolName: 'outside_project_test_tool',
        });
        expect(approvals[1]).toMatchObject({
            summary: 'Request access to path outside project: ../Desktop/notes.txt',
            toolName: 'outside_project_test_tool',
            risk: 'high',
        });
    });
});

function createTestTool(
    name: string,
    execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>,
): ITool {
    return {
        definition: {
            name,
            description: 'test tool',
            parameters: [],
        } satisfies ToolDefinition,
        execute,
    };
}
