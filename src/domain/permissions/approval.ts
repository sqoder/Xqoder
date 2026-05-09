export type ToolApprovalRisk = 'low' | 'medium' | 'high';
export type ToolApprovalDecision = 'allow' | 'ask' | 'deny';

export type ToolApprovalCategory =
    | 'outside-workspace-read'
    | 'sensitive-read'
    | 'protected-path'
    | 'high-risk-write'
    | 'dangerous-command'
    | 'network'
    | 'external-tool'
    | 'suspicious-path'
    | 'internal-runtime'
    | 'policy';

export interface ToolApprovalRequest {
    toolCallId?: string;
    toolName: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: ToolApprovalRisk;
    category?: ToolApprovalCategory;
    suggestion?: string;
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
    const category = patch.category ?? base.category;
    const suggestion = patch.suggestion ?? base.suggestion;

    return {
        ...base,
        summary: patch.summary ?? base.summary,
        ...(reason ? { reason } : {}),
        ...(preview ? { preview } : {}),
        ...toOptionalRisk(patch.risk ?? base.risk),
        ...(category ? { category } : {}),
        ...(suggestion ? { suggestion } : {}),
    };
}

export function mergeToolApprovalPatches(
    base: ToolApprovalPatch | undefined,
    extra: ToolApprovalPatch | undefined,
): ToolApprovalPatch | undefined {
    if (!base) {
        return extra;
    }
    if (!extra) {
        return base;
    }

    const force = base.force || extra.force;
    const reason = mergeText(base.reason, extra.reason);
    const preview = mergeText(base.preview, extra.preview);
    const risk = extra.risk ?? base.risk;
    const category = extra.category ?? base.category;
    const suggestion = extra.suggestion ?? base.suggestion;

    return {
        ...(force ? { force } : {}),
        ...((extra.summary ?? base.summary) ? { summary: extra.summary ?? base.summary } : {}),
        ...(reason ? { reason } : {}),
        ...(preview ? { preview } : {}),
        ...(risk ? { risk } : {}),
        ...(category ? { category } : {}),
        ...(suggestion ? { suggestion } : {}),
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
