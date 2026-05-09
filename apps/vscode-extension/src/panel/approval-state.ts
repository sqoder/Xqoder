export type PendingApproval = {
    requestId: string;
    streamId?: string;
    summary: string;
    toolName: string;
    preview?: string;
    reason?: string;
    risk?: 'low' | 'medium' | 'high';
};

export type PanelApproval = PendingApproval & {
    approvalKey: string;
};

export type ApprovalTarget = {
    requestId: string;
    streamId?: string;
};

export function getApprovalKey(approval: Pick<PendingApproval, 'requestId' | 'streamId'>): string {
    return approval.streamId ? `${approval.streamId}:${approval.requestId}` : approval.requestId;
}

export function toPanelApproval(approval: PendingApproval): PanelApproval {
    return {
        ...approval,
        approvalKey: getApprovalKey(approval),
    };
}

export function resolveApprovalTarget(
    approvalKey: string,
    pendingApprovals: ReadonlyMap<string, Pick<PendingApproval, 'requestId' | 'streamId'>>,
    activeStreamId?: string,
): ApprovalTarget {
    const approval = pendingApprovals.get(approvalKey);
    const streamId = approval?.streamId ?? normalizeString(activeStreamId);
    return {
        requestId: approval?.requestId ?? approvalKey,
        ...(streamId ? { streamId } : {}),
    };
}

export function toPendingApproval(payload: Record<string, unknown>, streamId?: string): PendingApproval {
    const rawRequest = typeof payload.payload === 'object' && payload.payload !== null
        ? payload.payload as Record<string, unknown>
        : {};
    const risk = rawRequest.risk;
    const payloadStreamId = normalizeString(payload.streamId) ?? normalizeString(streamId);
    return {
        requestId: String(payload.requestId ?? rawRequest.toolCallId ?? 'approval'),
        ...(payloadStreamId ? { streamId: payloadStreamId } : {}),
        summary: String(rawRequest.summary ?? payload.summary ?? 'Tool approval requested'),
        toolName: String(rawRequest.toolName ?? 'tool'),
        ...(typeof rawRequest.preview === 'string' && rawRequest.preview.trim().length > 0
            ? { preview: rawRequest.preview }
            : {}),
        ...(typeof rawRequest.reason === 'string' && rawRequest.reason.trim().length > 0
            ? { reason: rawRequest.reason }
            : {}),
        ...(risk === 'low' || risk === 'medium' || risk === 'high'
            ? { risk }
            : {}),
    };
}

export function toPendingApprovals(rawApprovals: unknown): PendingApproval[] {
    if (!Array.isArray(rawApprovals)) {
        return [];
    }

    return rawApprovals
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => {
            const risk = entry.risk;
            const streamId = normalizeString(entry.streamId);
            return {
                requestId: String(entry.requestId ?? entry.toolCallId ?? 'approval'),
                ...(streamId ? { streamId } : {}),
                summary: String(entry.summary ?? 'Tool approval requested'),
                toolName: String(entry.toolName ?? 'tool'),
                ...(typeof entry.preview === 'string' && entry.preview.trim().length > 0
                    ? { preview: entry.preview }
                    : {}),
                ...(typeof entry.reason === 'string' && entry.reason.trim().length > 0
                    ? { reason: entry.reason }
                    : {}),
                ...(risk === 'low' || risk === 'medium' || risk === 'high'
                    ? { risk }
                    : {}),
            };
        });
}

function normalizeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;
}
