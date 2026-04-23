import type {
    AgentPermissionMode,
    ExecutionCapability,
    HooksSettings,
    LLMProviderConfig,
    Logger,
    PermissionSettings,
    ToolCall,
    ToolResult,
} from '@xqoder/shared';
import { createToolApprovalHandler } from '../../application/permissions/index.js';
import type { ToolCallPreparation } from '../../domain/conversation/tool-execution-port.js';
import {
    buildHookBlockedResult,
    buildPermissionDeniedResult,
    createPreToolApprovalPatch,
    appendHookFeedback,
    applyPostToolHookFeedback,
} from './agent-hook-feedback.js';
import { buildPreToolUseHookPayload, runToolHooks, type ToolHookExecutionResult } from './hooks.js';
import type { AgentEvents } from './protocol.js';
import type { AgentSession } from './session/session.js';
import type { AgentCallbacks } from './agent.js';
import type { ITool, QuestionPrompt, ToolContext, ToolRegistry } from './tools/tool.js';
import {
    createToolPolicyApprovalPatch,
    isToolVisibleForExecutionCapability,
    isReadLikeTool,
    mergeToolApprovalPatches,
    resolveToolPermissionDecision,
} from '../../domain/permissions/index.js';

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
    executionCapability?: ExecutionCapability;
    disableAllHooks: boolean;
    hooks?: HooksSettings;
    emit: AgentEventEmitter;
}

export interface PreparedAgentToolCallState {
    dependencies: AgentToolExecutionDependencies;
    toolCall: ToolCall;
    args: Record<string, unknown>;
    callbacks?: AgentCallbacks;
    streamId: string;
    registeredTool?: ITool;
    permissionMode: AgentPermissionMode;
    preHookResult: ToolHookExecutionResult;
    policyApprovalPatch: ReturnType<typeof createToolPolicyApprovalPatch>;
    requestToolApproval?: (request: Parameters<ReturnType<typeof createToolApprovalHandler>>[0]) => Promise<boolean>;
    requestQuestion?: (prompt: QuestionPrompt) => Promise<{
        requestId: string;
        selected: string[];
        customText?: string;
    }>;
    blockedResult?: ToolResult;
    startedAt?: Date;
}

const EMPTY_PRE_TOOL_HOOK_RESULT: ToolHookExecutionResult = {
    continue: true,
    systemMessages: [],
    additionalContexts: [],
    handlers: [],
};

export async function executeAgentToolCalls(
    dependencies: AgentToolExecutionDependencies,
    toolCalls: ToolCall[],
    callbacks?: AgentCallbacks,
    streamId: string = 'global',
): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const tc of toolCalls) {
        const preparation = await prepareAgentToolCall(dependencies, tc, callbacks, streamId);
        const rawResult = preparation.state.blockedResult
            ? undefined
            : await invokePreparedAgentToolCall(preparation);
        results.push(await finalizePreparedAgentToolCall(preparation, rawResult));
    }

    return results;
}

export async function prepareAgentToolCall(
    dependencies: AgentToolExecutionDependencies,
    toolCall: ToolCall,
    callbacks?: AgentCallbacks,
    streamId: string = 'global',
): Promise<ToolCallPreparation<AgentCallbacks, PreparedAgentToolCallState>> {
    const args = parseToolCallArguments(toolCall, dependencies.logger);
    dependencies.logger.info(`Calling tool: ${toolCall.name}`);
    dependencies.emit('tool_request', { requestId: toolCall.id, name: toolCall.name, args }, streamId);

    const registeredTool = dependencies.toolRegistry.get(toolCall.name);
    const securityContext = registeredTool?.getSecurityPolicyContext?.();
    if (
        dependencies.executionCapability
        && !isToolVisibleForExecutionCapability(toolCall.name, dependencies.executionCapability, securityContext)
    ) {
        return {
            toolCall,
            args,
            callbacks,
            streamId,
            permissionMode: 'deny',
            blocked: true,
            preToolUseDetail: 'Skipped PreToolUse hooks because execution capability visibility rejected the tool call.',
            permissionDetail: `Denied tool execution because "${toolCall.name}" is not visible in execution capability ${dependencies.executionCapability}.`,
            state: {
                dependencies,
                toolCall,
                args,
                callbacks,
                streamId,
                registeredTool,
                permissionMode: 'deny',
                preHookResult: EMPTY_PRE_TOOL_HOOK_RESULT,
                policyApprovalPatch: undefined,
                blockedResult: {
                    toolCallId: toolCall.id,
                    success: false,
                    output: '',
                    error: `Tool "${toolCall.name}" is not available in the current execution capability (${dependencies.executionCapability})`,
                    metadata: {
                        stopReason: 'permission_denied',
                    },
                },
            },
        };
    }

    const hasPriorRead = dependencies.session.getToolHistory().some((entry) => isReadLikeTool(entry.name));
    const permissionMode = resolveToolPermissionDecision({
        toolName: toolCall.name,
        args,
        permissions: dependencies.permissions,
        hasPriorRead,
        projectRoot: dependencies.toolContext.projectRoot,
        securityContext,
    });
    const policyApprovalPatch = createToolPolicyApprovalPatch({
        toolName: toolCall.name,
        args,
        permissions: dependencies.permissions,
        hasPriorRead,
        projectRoot: dependencies.toolContext.projectRoot,
        securityContext,
        permissionMode,
        hasNativeApprovalRequest: Boolean(registeredTool?.buildApprovalRequest),
    });
    const preHookResult = await runToolHooks(
        'PreToolUse',
        buildPreToolUseHookPayload({
            sessionId: dependencies.session.id,
            cwd: dependencies.toolContext.cwd,
            projectRoot: dependencies.toolContext.projectRoot,
            permissionMode,
            toolName: toolCall.name,
            toolInput: args,
            toolUseId: toolCall.id,
        }),
        {
            disableAllHooks: dependencies.disableAllHooks,
            hooks: dependencies.hooks,
            llmConfig: dependencies.llmConfig,
            cwd: dependencies.toolContext.cwd,
            projectRoot: dependencies.toolContext.projectRoot,
            sessionId: dependencies.session.id,
            permissionMode,
            logger: dependencies.logger,
        },
    );
    for (const message of preHookResult.systemMessages) {
        dependencies.logger.warn(`PreToolUse hook message: ${message}`);
    }

    const blockedResult = preHookResult.permissionDecision === 'deny' || preHookResult.continue === false
        ? buildHookBlockedResult(toolCall.id, toolCall.name, preHookResult, args)
        : permissionMode === 'deny'
            ? buildPermissionDeniedResult(toolCall.id, toolCall.name, preHookResult.additionalContexts)
            : undefined;
    const blocked = blockedResult !== undefined;
    const forceInteractiveApproval = preHookResult.permissionDecision === 'ask' || Boolean(policyApprovalPatch?.force);
    const requestToolApproval = blocked
        ? undefined
        : createToolApprovalHandler({
            permissionMode,
            autoApproveTools: dependencies.autoApproveTools,
            forceInteractiveApproval,
            interactiveApproval: callbacks?.onToolApproval,
        });
    const requestQuestion = callbacks?.onQuestion
        ? (prompt: QuestionPrompt) => Promise.resolve(callbacks.onQuestion?.(prompt) ?? {
            requestId: prompt.requestId,
            selected: [],
        })
        : undefined;

    return {
        toolCall,
        args,
        callbacks,
        streamId,
        permissionMode,
        blocked,
        preToolUseDetail: blocked
            ? `PreToolUse hook chain blocked the tool call${preHookResult.permissionDecision ? ` (decision=${preHookResult.permissionDecision})` : ''}.`
            : `PreToolUse hook chain completed with permission mode ${permissionMode}.`,
        permissionDetail: blocked
            ? `Prepared a terminal permission result without raw tool invocation (${permissionMode}).`
            : `Resolved permission mode ${permissionMode}${forceInteractiveApproval ? ' with interactive approval enabled.' : '.'}`,
        state: {
            dependencies,
            toolCall,
            args,
            callbacks,
            streamId,
            registeredTool,
            permissionMode,
            preHookResult,
            policyApprovalPatch,
            requestToolApproval,
            requestQuestion,
            blockedResult,
        },
    };
}

export async function invokePreparedAgentToolCall(
    preparation: ToolCallPreparation<AgentCallbacks, PreparedAgentToolCallState>,
): Promise<ToolResult | undefined> {
    const state = preparation.state;
    if (state.blockedResult) {
        return undefined;
    }

    try { state.callbacks?.onToolStart?.(state.toolCall.name, state.args); } catch { /* noop */ }
    state.startedAt = new Date();
    return await state.dependencies.toolRegistry.execute(
        state.toolCall.name,
        state.args,
        {
            ...state.dependencies.toolContext,
            sessionId: state.dependencies.session.id,
            requestToolApproval: state.requestToolApproval,
            requestQuestion: state.requestQuestion,
            approvalRequestPatch: mergeToolApprovalPatches(
                state.policyApprovalPatch,
                createPreToolApprovalPatch(state.toolCall.name, state.args, state.preHookResult),
            ),
            onToolStream: (event) => {
                state.dependencies.emit('tool_update', {
                    requestId: state.toolCall.id,
                    chunk: event.chunk,
                    stream: event.stream,
                }, state.streamId);
                state.callbacks?.onToolStream?.(state.toolCall.name, event.chunk, event.stream);
            },
        },
        state.toolCall.id,
    );
}

export async function finalizePreparedAgentToolCall(
    preparation: ToolCallPreparation<AgentCallbacks, PreparedAgentToolCallState>,
    result: ToolResult | undefined,
): Promise<ToolResult> {
    const state = preparation.state;
    const rawResult = result ?? state.blockedResult ?? {
        toolCallId: state.toolCall.id,
        success: false,
        output: '',
        error: `Tool execution produced no result: ${state.toolCall.name}`,
    };
    const finalizedResult = state.blockedResult
        ? rawResult
        : await applyPostToolFinalization(state, rawResult);
    const startedAt = state.startedAt ?? new Date();
    const completedAt = new Date();
    const errorMessage = finalizedResult.error ?? 'Unknown tool failure';

    if (state.blockedResult) {
        try { state.callbacks?.onToolStart?.(state.toolCall.name, state.args); } catch { /* noop */ }
    }
    try { state.callbacks?.onToolEnd?.(state.toolCall.name, finalizedResult.output, finalizedResult.success); } catch { /* noop */ }

    state.dependencies.session.recordToolExecution({
        id: state.toolCall.id,
        name: state.toolCall.name,
        args: state.args,
        success: finalizedResult.success,
        output: finalizedResult.output,
        error: finalizedResult.success ? undefined : errorMessage,
        startedAt,
        completedAt,
        metadata: finalizedResult.metadata,
    });

    const resultContent = finalizedResult.success
        ? finalizedResult.output
        : `Error: ${errorMessage}`;
    state.dependencies.session.addToolResult(state.toolCall.id, resultContent);
    state.dependencies.emit('tool_response', {
        requestId: state.toolCall.id,
        name: state.toolCall.name,
        output: resultContent,
        success: finalizedResult.success,
    }, state.streamId);
    return finalizedResult;
}

async function applyPostToolFinalization(
    state: PreparedAgentToolCallState,
    result: ToolResult,
): Promise<ToolResult> {
    let finalizedResult = appendHookFeedback(result, 'PreToolUse', state.preHookResult.additionalContexts);
    finalizedResult = await applyPostToolHookFeedback(finalizedResult, {
        toolName: state.toolCall.name,
        toolArgs: state.args,
        toolCallId: state.toolCall.id,
        permissionMode: state.permissionMode,
        disableAllHooks: state.dependencies.disableAllHooks,
        hooks: state.dependencies.hooks,
        llmConfig: state.dependencies.llmConfig,
        cwd: state.dependencies.toolContext.cwd,
        projectRoot: state.dependencies.toolContext.projectRoot,
        sessionId: state.dependencies.session.id,
        logger: state.dependencies.logger,
    });
    return finalizedResult;
}

function parseToolCallArguments(
    toolCall: ToolCall,
    logger: Logger,
): Record<string, unknown> {
    try {
        return (toolCall.arguments ? JSON.parse(toolCall.arguments) : {}) as Record<string, unknown>;
    } catch {
        logger.warn(`Tool ${toolCall.name} arguments parsing failed: ${toolCall.arguments?.slice(0, 100)}`);
        return {};
    }
}
