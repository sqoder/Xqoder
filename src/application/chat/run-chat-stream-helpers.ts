import type { AgentCallbacks } from '@xqoder/agent';
import type { AppEvent, JsonValue } from '@xqoder/protocol';
import { runWriteAutoWorkingNotepadCommand } from '../system/notepad.js';
import type { PreparedChatExecution } from './turn-intake.js';

type ToolApprovalRequest = Parameters<NonNullable<AgentCallbacks['onToolApproval']>>[0];

export function createStreamToolApprovalHandler(options: {
    emitEvent: (event: AppEvent) => void;
    requestToolApproval?: AgentCallbacks['onToolApproval'];
    sessionId: string;
}): AgentCallbacks['onToolApproval'] | undefined {
    const requestToolApproval = options.requestToolApproval;
    if (!requestToolApproval) {
        return undefined;
    }

    return async (request: ToolApprovalRequest): Promise<boolean> => {
        const requestId = typeof request.toolCallId === 'string' && request.toolCallId.trim().length > 0
            ? request.toolCallId.trim()
            : `approval-${Date.now()}`;
        const normalizedRequest = {
            ...request,
            toolCallId: requestId,
            toolName: typeof request.toolName === 'string' && request.toolName.trim().length > 0
                ? request.toolName
                : 'tool',
            summary: typeof request.summary === 'string' && request.summary.trim().length > 0
                ? request.summary
                : 'Tool approval requested',
        };

        options.emitEvent({
            type: 'approval.requested',
            sessionId: options.sessionId,
            timestamp: Date.now(),
            source: 'agent',
            requestId,
            kind: 'tool',
            summary: normalizedRequest.summary,
            payload: normalizedRequest as unknown as JsonValue,
        });

        const approved = await Promise.resolve(requestToolApproval(normalizedRequest) ?? false);
        options.emitEvent({
            type: 'approval.resolved',
            sessionId: options.sessionId,
            timestamp: Date.now(),
            source: 'agent',
            requestId,
            decision: approved ? 'allow' : 'deny',
        });
        return approved;
    };
}

export function writeAutoWorkingMemoryNote(
    execution: PreparedChatExecution,
    response: string,
): void {
    if (!execution.turnInput.shouldPersistSession) {
        return;
    }

    try {
        runWriteAutoWorkingNotepadCommand({
            prompt: execution.turnInput.rawPrompt,
            response,
        }, {
            cwd: execution.turnInput.resolvedDir,
        }, {
            writeOutput: () => {},
        });
    } catch {
        // Memory persistence is best-effort and must not fail the main chat turn.
    }
}
