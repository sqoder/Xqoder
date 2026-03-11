import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ITool, type ToolContext } from './tool.js';

describe('ToolRegistry approvals', () => {
    it('returns a rejection result when approval is denied', async () => {
        const registry = new ToolRegistry();
        const tool: ITool = {
            definition: {
                name: 'dangerous_tool',
                description: 'dangerous tool',
                parameters: [],
            },
            buildApprovalRequest: () => ({
                toolCallId: '',
                toolName: 'dangerous_tool',
                summary: 'dangerous',
            }),
            execute: async () => ({
                toolCallId: '1',
                success: true,
                output: 'should not run',
            }),
        };
        const context: ToolContext = {
            cwd: '/workspace/demo',
            projectRoot: '/workspace/demo',
            requestToolApproval: async () => false,
        };

        registry.register(tool);
        const result = await registry.execute('dangerous_tool', {}, context, '1');

        expect(result.success).toBe(false);
        expect(result.error).toContain('审批被拒绝');
    });
});
