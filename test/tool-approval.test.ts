import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { RunShellTool } from '../src/core/agent/tools/command-tool.js';
import { WriteFileTool } from '../src/core/agent/tools/file-tools.js';
import { ToolRegistry, type ITool, type ToolContext, type ToolApprovalRequest } from '../src/core/agent/tools/tool.js';

describe('tool approval flow', () => {
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
