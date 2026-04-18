export type ToolApprovalRisk = 'low' | 'medium' | 'high';
export type ToolApprovalDecision = 'allow' | 'ask' | 'deny';

export interface ToolApprovalRequest {
    toolCallId?: string;
    toolName: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: ToolApprovalRisk;
}

export interface ToolApprovalPatch extends Partial<ToolApprovalRequest> {
    force?: boolean;
}

export interface ToolApprovalPrompt {
    toolCallId: string;
    toolName: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: ToolApprovalRisk;
}

export interface ApprovalRequestedRecord {
    requestId: string;
    kind: 'tool.use';
    summary: string;
    payload?: string;
}

export interface ApprovalResolvedRecord {
    requestId: string;
    decision: ToolApprovalDecision;
}

export function mergeToolApprovalRequest(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string,
    request: ToolApprovalRequest | undefined,
    patch: ToolApprovalPatch | undefined,
): ToolApprovalRequest | undefined {
    if (!patch) {
        return request;
    }

    const defaultPreview = safeFormatArgs(args);
    const base = request ?? (patch.force
        ? {
            toolCallId,
            toolName,
            summary: patch.summary ?? `Hook requires approval before running ${toolName}`,
            ...(patch.reason ? { reason: patch.reason } : {}),
            preview: patch.preview ?? defaultPreview,
            ...(patch.risk ? { risk: patch.risk } : {}),
        }
        : undefined);

    if (!base) {
        return undefined;
    }

    const reason = mergeText(base.reason, patch.reason);
    const preview = mergeText(base.preview, patch.preview);

    return {
        ...base,
        summary: patch.summary ?? base.summary,
        ...(reason ? { reason } : {}),
        ...(preview ? { preview } : {}),
        ...toOptionalRisk(patch.risk ?? base.risk),
    };
}

export function createApprovalRequestId(sessionId: string, toolCallId: string | undefined): string {
    return `${sessionId}:${toolCallId ?? 'unknown-tool-call'}`;
}

export function createToolApprovalPrompt(
    request: ToolApprovalRequest,
    fallbackToolCallId: string = 'unknown-tool-call',
): ToolApprovalPrompt {
    return {
        toolCallId: request.toolCallId ?? fallbackToolCallId,
        toolName: request.toolName,
        summary: request.summary,
        ...(request.reason ? { reason: request.reason } : {}),
        ...(request.preview ? { preview: request.preview } : {}),
        ...toOptionalRisk(request.risk),
    };
}

export function createApprovalRequestedRecord(
    requestId: string,
    request: ToolApprovalRequest,
): ApprovalRequestedRecord {
    const payload = request.preview ?? request.reason;

    return {
        requestId,
        kind: 'tool.use',
        summary: request.summary,
        ...(payload ? { payload } : {}),
    };
}

export function createApprovalResolvedRecord(
    requestId: string,
    decision: ToolApprovalDecision,
): ApprovalResolvedRecord {
    return {
        requestId,
        decision,
    };
}

function mergeText(base: string | undefined, extra: string | undefined): string | undefined {
    if (!base) {
        return extra;
    }
    if (!extra || extra === base) {
        return base;
    }
    return `${base}\n\n${extra}`;
}

function safeFormatArgs(args: Record<string, unknown>): string {
    try {
        return JSON.stringify(args, null, 2);
    } catch {
        return '[unserializable tool arguments]';
    }
}

function toOptionalRisk(risk: ToolApprovalRisk | undefined): Partial<Pick<ToolApprovalRequest, 'risk'>> {
    return risk ? { risk } : {};
}
