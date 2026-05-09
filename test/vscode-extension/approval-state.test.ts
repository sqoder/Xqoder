import { describe, expect, it } from 'bun:test';
import {
    getApprovalKey,
    resolveApprovalTarget,
    toPanelApproval,
    toPendingApproval,
    toPendingApprovals,
} from '../../apps/vscode-extension/src/panel/approval-state.js';

describe('VS Code approval state helpers', () => {
    it('keeps approvals with the same request id isolated by stream id', () => {
        const first = toPendingApproval({
            requestId: 'tool-call-shared',
            payload: {
                toolName: 'edit_file',
                summary: 'Edit from stream A',
            },
        }, 'stream-a');
        const second = toPendingApproval({
            requestId: 'tool-call-shared',
            payload: {
                toolName: 'write_file',
                summary: 'Write from stream B',
            },
        }, 'stream-b');

        expect(getApprovalKey(first)).toBe('stream-a:tool-call-shared');
        expect(getApprovalKey(second)).toBe('stream-b:tool-call-shared');
    });

    it('resolves a selected stream-specific key back to the original request and stream', () => {
        const pending = new Map([
            ['stream-a:tool-call-shared', {
                requestId: 'tool-call-shared',
                streamId: 'stream-a',
            }],
            ['stream-b:tool-call-shared', {
                requestId: 'tool-call-shared',
                streamId: 'stream-b',
            }],
        ]);

        expect(resolveApprovalTarget('stream-b:tool-call-shared', pending, 'stream-a')).toEqual({
            requestId: 'tool-call-shared',
            streamId: 'stream-b',
        });
    });

    it('hydrates restored pending approvals with stable webview approval keys', () => {
        const approvals = toPendingApprovals([
            {
                requestId: 'tool-call-shared',
                streamId: 'stream-a',
                toolName: 'edit_file',
                summary: 'Edit from stream A',
                preview: '-old\n+new',
                risk: 'medium',
            },
            {
                requestId: 'tool-call-shared',
                streamId: 'stream-b',
                toolName: 'write_file',
                summary: 'Write from stream B',
            },
        ]).map(toPanelApproval);

        expect(approvals.map((approval) => approval.approvalKey)).toEqual([
            'stream-a:tool-call-shared',
            'stream-b:tool-call-shared',
        ]);
        expect(approvals[0]).toMatchObject({
            approvalKey: 'stream-a:tool-call-shared',
            requestId: 'tool-call-shared',
            streamId: 'stream-a',
            preview: '-old\n+new',
            risk: 'medium',
        });
    });

    it('keeps legacy approvals request-id keyed and resolves with the active stream fallback', () => {
        const approval = toPendingApproval({
            requestId: 'legacy-request',
            payload: {
                toolName: 'run_shell',
                summary: 'Run command',
            },
        });
        const pending = new Map([[getApprovalKey(approval), approval]]);

        expect(toPanelApproval(approval)).toMatchObject({
            approvalKey: 'legacy-request',
            requestId: 'legacy-request',
        });
        expect(resolveApprovalTarget('legacy-request', pending, 'active-stream')).toEqual({
            requestId: 'legacy-request',
            streamId: 'active-stream',
        });
    });

    it('exposes the approval key used by full-diff preview actions', () => {
        const approval = toPanelApproval(toPendingApproval({
            requestId: 'diff-request',
            streamId: 'stream-from-payload',
            payload: {
                toolName: 'edit_file',
                summary: 'Edit file',
                preview: '-before\n+after',
            },
        }, 'stream-from-record'));

        expect(approval.approvalKey).toBe('stream-from-payload:diff-request');
        expect(approval.preview).toBe('-before\n+after');
    });
});
