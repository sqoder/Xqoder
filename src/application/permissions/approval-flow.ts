import type { AgentPermissionMode } from '@xqoder/shared';
import {
    createApprovalRequestId,
    createApprovalRequestedRecord,
    createApprovalResolvedRecord,
    createToolApprovalPrompt,
    type ApprovalRequestedRecord,
    type ApprovalResolvedRecord,
    type ToolApprovalDecision,
    type ToolApprovalPrompt,
    type ToolApprovalRequest,
} from '../../domain/permissions/index.js';

export interface ApprovalDecisionContext {
    permissionMode: AgentPermissionMode;
    autoApproveTools: boolean;
    forceInteractiveApproval: boolean;
    interactiveApproval?: (request: ToolApprovalRequest) => Promise<boolean> | boolean;
}

export interface RuntimeApprovalResolutionOptions {
    request: ToolApprovalRequest;
    sessionId: string;
    cwd: string;
    permissionPolicy: {
        evaluate: (request: {
            kind: 'tool.use';
            target: string;
            sessionId: string;
            cwd: string;
            payload?: string;
        }) => ToolApprovalDecision | Promise<ToolApprovalDecision>;
    };
    requestToolApproval?: (request: ToolApprovalPrompt) => Promise<'allow' | 'deny'> | 'allow' | 'deny';
    onApprovalRequested?: (record: ApprovalRequestedRecord) => void | Promise<void>;
    onApprovalResolved?: (record: ApprovalResolvedRecord) => void | Promise<void>;
}

export function createToolApprovalHandler(
    context: ApprovalDecisionContext,
): (request: ToolApprovalRequest) => Promise<boolean> {
    return async (request: ToolApprovalRequest): Promise<boolean> => {
        if (!context.forceInteractiveApproval && (context.permissionMode === 'allow' || context.autoApproveTools)) {
            return true;
        }

        if (!context.interactiveApproval) {
            return false;
        }

        return Boolean(await context.interactiveApproval(request));
    };
}

export async function resolveRuntimeApprovalRequest(
    options: RuntimeApprovalResolutionOptions,
): Promise<boolean> {
    const requestId = createApprovalRequestId(options.sessionId, options.request.toolCallId);

    if (options.requestToolApproval) {
        await options.onApprovalRequested?.(createApprovalRequestedRecord(requestId, options.request));
        const decision = await options.requestToolApproval(createToolApprovalPrompt(options.request));
        await options.onApprovalResolved?.(createApprovalResolvedRecord(requestId, decision));
        return decision === 'allow';
    }

    const decision = await options.permissionPolicy.evaluate({
        kind: 'tool.use',
        target: options.request.toolName,
        sessionId: options.sessionId,
        cwd: options.cwd,
        ...((options.request.preview ?? options.request.reason) !== undefined
            ? { payload: options.request.preview ?? options.request.reason }
            : {}),
    });

    if (decision !== 'allow') {
        await options.onApprovalRequested?.(createApprovalRequestedRecord(requestId, options.request));
    }

    await options.onApprovalResolved?.(createApprovalResolvedRecord(requestId, decision));
    return decision === 'allow';
}
