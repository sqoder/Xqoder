import type {
    HooksSettings,
    LLMProviderConfig,
    Logger,
    PermissionSettings,
    ToolCall,
    ToolResult,
} from '@xqoder/shared';
import { createToolApprovalHandler } from '../../application/permissions/index.js';
import { resolveToolPermissionMode } from '../../domain/permissions/index.js';
import {
    buildHookBlockedResult,
    buildPermissionDeniedResult,
    createPreToolApprovalPatch,
    appendHookFeedback,
    applyPostToolHookFeedback,
} from './agent-hook-feedback.js';
import { buildPreToolUseHookPayload, runToolHooks } from './hooks.js';
import type { AgentEvents } from './protocol.js';
import type { AgentSession } from './session/session.js';
import type { AgentCallbacks } from './agent.js';
import type { QuestionPrompt, ToolContext, ToolRegistry } from './tools/tool.js';

export type AgentEventEmitter = <K extends keyof AgentEvents>(
    type: K,
    data: AgentEvents[K],
    streamId?: string,
) => void;

export interface AgentToolExecutionDependencies {
    toolRegistry: ToolRegistry;
    session: AgentSession;
    toolContext: ToolContext;
    logger: Logger;
    llmConfig: LLMProviderConfig;
    autoApproveTools: boolean;
    permissions?: PermissionSettings;
    disableAllHooks: boolean;
    hooks?: HooksSettings;
    emit: AgentEventEmitter;
}

export async function executeAgentToolCalls(
    dependencies: AgentToolExecutionDependencies,
    toolCalls: ToolCall[],
    callbacks?: AgentCallbacks,
    streamId: string = 'global',
): Promise<void> {
    for (const tc of toolCalls) {
        let args: Record<string, unknown>;
        try {
            args = (tc.arguments ? JSON.parse(tc.arguments) : {}) as Record<string, unknown>;
        } catch {
            args = {};
            dependencies.logger.warn(`Tool ${tc.name} arguments parsing failed: ${tc.arguments?.slice(0, 100)}`);
        }
        dependencies.logger.info(`Calling tool: ${tc.name}`);
        dependencies.emit('tool_request', { requestId: tc.id, name: tc.name, args }, streamId);

        const perm = resolveToolPermissionMode(tc.name, dependencies.permissions);
        const preHookResult = await runToolHooks(
            'PreToolUse',
            buildPreToolUseHookPayload({
                sessionId: dependencies.session.id,
                cwd: dependencies.toolContext.cwd,
                projectRoot: dependencies.toolContext.projectRoot,
                permissionMode: perm,
                toolName: tc.name,
                toolInput: args,
                toolUseId: tc.id,
            }),
            {
                disableAllHooks: dependencies.disableAllHooks,
                hooks: dependencies.hooks,
                llmConfig: dependencies.llmConfig,
                cwd: dependencies.toolContext.cwd,
                projectRoot: dependencies.toolContext.projectRoot,
                sessionId: dependencies.session.id,
                permissionMode: perm,
                logger: dependencies.logger,
            },
        );
        for (const message of preHookResult.systemMessages) {
            dependencies.logger.warn(`PreToolUse hook message: ${message}`);
        }

        if (preHookResult.permissionDecision === 'deny' || preHookResult.continue === false) {
            finalizeToolCall(
                dependencies,
                tc,
                args,
                buildHookBlockedResult(tc.id, tc.name, preHookResult, args),
                callbacks,
                streamId,
            );
            continue;
        }

        if (perm === 'deny') {
            finalizeToolCall(
                dependencies,
                tc,
                args,
                buildPermissionDeniedResult(tc.id, tc.name, preHookResult.additionalContexts),
                callbacks,
                streamId,
            );
            continue;
        }

        const requestToolApproval = createToolApprovalHandler({
            permissionMode: perm,
            autoApproveTools: dependencies.autoApproveTools,
            forceInteractiveApproval: preHookResult.permissionDecision === 'ask',
            interactiveApproval: callbacks?.onToolApproval,
        });
        const requestQuestion = callbacks?.onQuestion
            ? (prompt: QuestionPrompt) => Promise.resolve(callbacks.onQuestion?.(prompt) ?? {
                requestId: prompt.requestId,
                selected: [],
            })
            : undefined;

        try { callbacks?.onToolStart?.(tc.name, args); } catch { /* UI callback must not crash agent */ }
        const startedAt = new Date();

        let result = await dependencies.toolRegistry.execute(
            tc.name,
            args,
            {
                ...dependencies.toolContext,
                sessionId: dependencies.session.id,
                requestToolApproval,
                requestQuestion,
                approvalRequestPatch: createPreToolApprovalPatch(tc.name, args, preHookResult),
                onToolStream: (event) => {
                    dependencies.emit('tool_update', { requestId: tc.id, chunk: event.chunk, stream: event.stream }, streamId);
                    callbacks?.onToolStream?.(tc.name, event.chunk, event.stream);
                },
            },
            tc.id,
        );
        result = appendHookFeedback(result, 'PreToolUse', preHookResult.additionalContexts);
        result = await applyPostToolHookFeedback(result, {
            toolName: tc.name,
            toolArgs: args,
            toolCallId: tc.id,
            permissionMode: perm,
            disableAllHooks: dependencies.disableAllHooks,
            hooks: dependencies.hooks,
            llmConfig: dependencies.llmConfig,
            cwd: dependencies.toolContext.cwd,
            projectRoot: dependencies.toolContext.projectRoot,
            sessionId: dependencies.session.id,
            logger: dependencies.logger,
        });
        const completedAt = new Date();

        try { callbacks?.onToolEnd?.(tc.name, result.output, result.success); } catch { /* UI callback must not crash agent */ }
        dependencies.session.recordToolExecution({
            id: tc.id,
            name: tc.name,
            args,
            success: result.success,
            output: result.output,
            error: result.error,
            startedAt,
            completedAt,
            metadata: result.metadata,
        });

        const resultContent = result.success
            ? result.output
            : `Error: ${result.error}`;
        dependencies.session.addToolResult(tc.id, resultContent);
        dependencies.emit('tool_response', { requestId: tc.id, name: tc.name, output: resultContent, success: result.success }, streamId);
    }
}

function finalizeToolCall(
    dependencies: AgentToolExecutionDependencies,
    toolCall: ToolCall,
    args: Record<string, unknown>,
    result: ToolResult,
    callbacks: AgentCallbacks | undefined,
    streamId: string,
): void {
    try { callbacks?.onToolStart?.(toolCall.name, args); } catch { /* noop */ }
    try { callbacks?.onToolEnd?.(toolCall.name, result.output, false); } catch { /* noop */ }
    const errorMessage = result.error ?? 'Unknown tool failure';
    dependencies.session.recordToolExecution({
        id: toolCall.id,
        name: toolCall.name,
        args,
        success: false,
        output: result.output,
        error: errorMessage,
        startedAt: new Date(),
        completedAt: new Date(),
        metadata: result.metadata,
    });
    dependencies.session.addToolResult(toolCall.id, `Error: ${errorMessage}`);
    dependencies.emit('tool_response', { requestId: toolCall.id, name: toolCall.name, output: errorMessage, success: false }, streamId);
}
