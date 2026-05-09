import { describe, expect, it } from 'bun:test';
import * as os from 'node:os';
import { ExitPlanModeTool } from '../../src/core/agent/tools/interaction-tools.js';
import { ToolRegistry } from '../../src/core/agent/tools/tool.js';
import type { ToolContext, ToolApprovalRequest } from '../../src/core/agent/tools/tool.js';

function createContext(requestToolApproval?: (req: ToolApprovalRequest) => Promise<boolean>): ToolContext {
    const ctx: ToolContext = {
        cwd: os.tmpdir(),
        projectRoot: os.tmpdir(),
    };
    if (requestToolApproval) {
        ctx.requestToolApproval = requestToolApproval;
    }
    return ctx;
}

describe('ExitPlanModeTool', () => {
    it('forces an approval request carrying the plan as preview and policy category', () => {
        const tool = new ExitPlanModeTool();
        const request = tool.buildApprovalRequest?.(
            { plan: 'Step 1: read lib/foo.ts\nStep 2: add parser\nStep 3: run tests', toolCallId: 'call-1' },
            createContext(),
        );

        expect(request).toBeDefined();
        expect(request).toMatchObject({
            toolCallId: 'call-1',
            toolName: 'exit_plan_mode',
            category: 'policy',
            risk: 'medium',
        });
        expect(request?.preview).toContain('Step 1: read lib/foo.ts');
        expect(request?.summary).toContain('Exit plan mode');
    });

    it('returns a stop-now instruction to the model when the user allows the approval', async () => {
        const tool = new ExitPlanModeTool();
        const registry = new ToolRegistry();
        registry.register(tool);

        let approvedRequest: ToolApprovalRequest | undefined;
        const context = createContext(async (req) => {
            approvedRequest = req;
            return true;
        });

        const result = await registry.execute(
            'exit_plan_mode',
            { plan: 'Step 1: refactor parser\nStep 2: verify tests' },
            context,
            'call-2',
        );

        expect(result.success).toBe(true);
        expect(approvedRequest?.toolName).toBe('exit_plan_mode');
        expect(result.output).toContain('Plan approved by the user');
        expect(result.output).toContain('Stop generating now');
        expect(result.output).toContain('Step 1: refactor parser');
        expect(result.metadata).toMatchObject({
            requiresFollowUpImplement: true,
        });
    });

    it('reports permission_denied when the user denies the approval', async () => {
        const tool = new ExitPlanModeTool();
        const registry = new ToolRegistry();
        registry.register(tool);

        const context = createContext(async () => false);

        const result = await registry.execute(
            'exit_plan_mode',
            { plan: 'Step 1: refactor parser' },
            context,
            'call-3',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tool approval denied');
        expect(result.metadata).toMatchObject({ stopReason: 'permission_denied' });
    });

    it('rejects empty plans even when approved, because there is nothing to execute', async () => {
        const tool = new ExitPlanModeTool();
        const registry = new ToolRegistry();
        registry.register(tool);

        const context = createContext(async () => true);

        const result = await registry.execute(
            'exit_plan_mode',
            { plan: '   ' },
            context,
            'call-4',
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Plan content is required');
    });
});
