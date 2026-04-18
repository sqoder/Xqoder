import { describe, expect, it } from 'bun:test';
import {
    createToolApprovalHandler,
    resolveRuntimeApprovalRequest,
} from '../src/application/permissions/index.js';
import type {
    ToolApprovalRequest,
} from '../src/domain/permissions/index.js';

describe('approval flow helpers', () => {
    it('auto-approves when permission mode allows it', async () => {
        const handler = createToolApprovalHandler({
            permissionMode: 'allow',
            autoApproveTools: false,
            forceInteractiveApproval: false,
        });

        expect(await handler(baseApprovalRequest())).toBe(true);
    });

    it('forces interactive approval when requested by hook logic', async () => {
        let prompted = 0;
        const handler = createToolApprovalHandler({
            permissionMode: 'allow',
            autoApproveTools: true,
            forceInteractiveApproval: true,
            interactiveApproval: async () => {
                prompted += 1;
                return false;
            },
        });

        expect(await handler(baseApprovalRequest())).toBe(false);
        expect(prompted).toBe(1);
    });

    it('resolves runtime approval through an interactive requester when present', async () => {
        const requested: string[] = [];
        const resolved: string[] = [];

        const allowed = await resolveRuntimeApprovalRequest({
            request: baseApprovalRequest(),
            sessionId: 'session-1',
            cwd: '/tmp/project',
            permissionPolicy: {
                evaluate: async () => 'deny',
            },
            requestToolApproval: async () => 'allow',
            onApprovalRequested: (record) => {
                requested.push(record.requestId);
            },
            onApprovalResolved: (record) => {
                resolved.push(`${record.requestId}:${record.decision}`);
            },
        });

        expect(allowed).toBe(true);
        expect(requested).toEqual(['session-1:call-1']);
        expect(resolved).toEqual(['session-1:call-1:allow']);
    });

    it('falls back to permission policy when no interactive requester exists', async () => {
        const decisions: string[] = [];

        const allowed = await resolveRuntimeApprovalRequest({
            request: baseApprovalRequest(),
            sessionId: 'session-2',
            cwd: '/tmp/project',
            permissionPolicy: {
                evaluate: async () => 'ask',
            },
            onApprovalResolved: (record) => {
                decisions.push(record.decision);
            },
        });

        expect(allowed).toBe(false);
        expect(decisions).toEqual(['ask']);
    });

    it('omits payload when no preview or reason is available', async () => {
        const payloads: Array<string | undefined> = [];
        const keysSeen: string[][] = [];

        await resolveRuntimeApprovalRequest({
            request: {
                ...baseApprovalRequest(),
                reason: undefined,
                preview: undefined,
            },
            sessionId: 'session-3',
            cwd: '/tmp/project',
            permissionPolicy: {
                evaluate: async (request) => {
                    payloads.push(request.payload);
                    keysSeen.push(Object.keys(request).sort());
                    return 'allow';
                },
            },
        });

        expect(payloads).toEqual([undefined]);
        expect(keysSeen).toEqual([['cwd', 'kind', 'sessionId', 'target']]);
    });
});

function baseApprovalRequest(): ToolApprovalRequest {
    return {
        toolCallId: 'call-1',
        toolName: 'write_file',
        summary: 'Write a file',
        reason: 'Needs file mutation',
        preview: '{"path":"a.txt"}',
        risk: 'high',
    };
}
