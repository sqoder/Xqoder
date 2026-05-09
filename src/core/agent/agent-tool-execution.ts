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
import * as fs from 'node:fs';
import * as path from 'node:path';
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
import {
    getToolResultSizeLimit,
    isToolInvocationConcurrencySafe,
    isToolInvocationReadOnly,
    shouldPersistLargeToolResult,
    validateExistingFileWasFullyRead,
    type ITool,
    type QuestionPrompt,
    type ToolContext,
    type ToolRegistry,
} from './tools/tool.js';
import {
    createToolPolicyApprovalPatch,
    isToolVisibleForExecutionCapability,
    isReadLikeTool,
    isWriteLikeTool,
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

const DEFAULT_TOOL_RESULT_SIZE_LIMIT_CHARS = 50_000;
const LARGE_TOOL_RESULT_PREVIEW_CHARS = 4_000;

export async function executeAgentToolCalls(
    dependencies: AgentToolExecutionDependencies,
    toolCalls: ToolCall[],
    callbacks?: AgentCallbacks,
    streamId: string = 'global',
): Promise<ToolResult[]> {
    const preparations: ToolCallPreparation<AgentCallbacks, PreparedAgentToolCallState>[] = [];
    for (const toolCall of toolCalls) {
        preparations.push(await prepareAgentToolCall(dependencies, toolCall, callbacks, streamId));
    }

    const results: ToolResult[] = [];
    for (let index = 0; index < preparations.length;) {
        const preparation = preparations[index]!;
        if (preparation.canRunInParallel) {
            const batch: ToolCallPreparation<AgentCallbacks, PreparedAgentToolCallState>[] = [];
            while (index < preparations.length && preparations[index]?.canRunInParallel) {
                batch.push(preparations[index]!);
                index += 1;
            }
            const rawResults = await Promise.all(batch.map((item) => invokePreparedAgentToolCall(item)));
            for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
                results.push(await finalizePreparedAgentToolCall(batch[batchIndex]!, rawResults[batchIndex]));
            }
            continue;
        }

        const rawResult = preparation.state.blockedResult
            ? undefined
            : await invokePreparedAgentToolCall(preparation);
        results.push(await finalizePreparedAgentToolCall(preparation, rawResult));
        index += 1;
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

    const hasPriorRead = hasRequiredFileReadStateForTool(toolCall.name, args, dependencies.toolContext);
    const permissionMode = resolveToolPermissionDecision({
        toolName: toolCall.name,
        args,
        permissions: dependencies.permissions,
        hasPriorRead,
        cwd: dependencies.toolContext.cwd,
        projectRoot: dependencies.toolContext.projectRoot,
        allowedPaths: dependencies.toolContext.allowedPaths,
        approvedReadPaths: dependencies.toolContext.approvedReadPaths,
        securityContext,
    });
    const policyApprovalPatch = createToolPolicyApprovalPatch({
        toolName: toolCall.name,
        args,
        permissions: dependencies.permissions,
        hasPriorRead,
        cwd: dependencies.toolContext.cwd,
        projectRoot: dependencies.toolContext.projectRoot,
        allowedPaths: dependencies.toolContext.allowedPaths,
        approvedReadPaths: dependencies.toolContext.approvedReadPaths,
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
    const canRunInParallel = !blocked
        && permissionMode === 'allow'
        && isPreparedToolCallParallelSafe({
            toolName: toolCall.name,
            args,
            context: dependencies.toolContext,
            registeredTool,
            securityContext,
        });

    return {
        toolCall,
        args,
        callbacks,
        streamId,
        permissionMode,
        blocked,
        canRunInParallel,
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
    state.dependencies.toolContext.approvedReadPaths ??= [];
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
    const projectedResult = projectLargeToolResultIfNeeded(state, finalizedResult);
    const startedAt = state.startedAt ?? new Date();
    const completedAt = new Date();
    const errorMessage = projectedResult.error ?? 'Unknown tool failure';
    const resultContent = projectedResult.success
        ? projectedResult.output
        : `Error: ${errorMessage}`;

    if (state.blockedResult) {
        try { state.callbacks?.onToolStart?.(state.toolCall.name, state.args); } catch { /* noop */ }
    }
    try { state.callbacks?.onToolEnd?.(state.toolCall.name, resultContent, projectedResult.success); } catch { /* noop */ }

    state.dependencies.session.recordToolExecution({
        id: state.toolCall.id,
        name: state.toolCall.name,
        args: state.args,
        success: projectedResult.success,
        output: projectedResult.output,
        error: projectedResult.success ? undefined : errorMessage,
        startedAt,
        completedAt,
        metadata: projectedResult.metadata,
    });

    state.dependencies.session.addToolResult(state.toolCall.id, resultContent, projectedResult.attachments);
    state.dependencies.emit('tool_response', {
        requestId: state.toolCall.id,
        name: state.toolCall.name,
        output: resultContent,
        success: projectedResult.success,
    }, state.streamId);
    return projectedResult;
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

function hasRequiredFileReadStateForTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
): boolean {
    if (!isWriteLikeTool(toolName)) {
        return true;
    }

    const targetPaths = resolveWriteTargetPaths(toolName, args, context);
    if (targetPaths.length === 0) {
        return false;
    }

    return targetPaths.every((filePath) => validateExistingFileWasFullyRead(filePath, context) === undefined);
}

function resolveWriteTargetPaths(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
): string[] {
    if (toolName === 'apply_patch') {
        return resolvePatchTargetPaths(String(args['patch'] ?? ''), context);
    }

    const candidate = args['path'] ?? args['file_path'];
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        return [];
    }
    return [resolveToolInputPath(candidate, context)];
}

function resolvePatchTargetPaths(patch: string, context: ToolContext): string[] {
    const filePaths = new Set<string>();
    for (const line of patch.split('\n')) {
        if (line.startsWith('+++ ') || line.startsWith('--- ')) {
            const rawPath = line.slice(4).trim();
            if (rawPath !== '/dev/null') {
                filePaths.add(resolveToolInputPath(stripPatchPrefix(rawPath), context));
            }
            continue;
        }

        if (line.startsWith('diff --git ')) {
            const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            const candidate = match?.[2] ?? match?.[1];
            if (candidate) {
                filePaths.add(resolveToolInputPath(candidate, context));
            }
        }
    }

    return Array.from(filePaths);
}

function stripPatchPrefix(value: string): string {
    return value.startsWith('a/') || value.startsWith('b/')
        ? value.slice(2)
        : value;
}

function resolveToolInputPath(value: string, context: ToolContext): string {
    return path.resolve(path.isAbsolute(value) ? value : path.join(context.projectRoot, value));
}

function isPreparedToolCallParallelSafe(input: {
    toolName: string;
    args: Record<string, unknown>;
    context: ToolContext;
    registeredTool?: ITool;
    securityContext?: ReturnType<NonNullable<ITool['getSecurityPolicyContext']>>;
}): boolean {
    const readOnly = isToolInvocationReadOnly(input.registeredTool, input.args, input.context)
        || isReadLikeTool(input.toolName, input.securityContext);
    const concurrencySafe = isToolInvocationConcurrencySafe(input.registeredTool, input.args, input.context);

    return readOnly && concurrencySafe;
}

function projectLargeToolResultIfNeeded(
    state: PreparedAgentToolCallState,
    result: ToolResult,
): ToolResult {
    if (!result.success || !shouldPersistLargeToolResult(state.registeredTool)) {
        return result;
    }

    const output = result.output ?? '';
    const limit = getToolResultSizeLimit(state.registeredTool, DEFAULT_TOOL_RESULT_SIZE_LIMIT_CHARS);
    if (output.length <= limit) {
        return result;
    }

    const persistedOutputPath = persistToolOutput({
        projectRoot: state.dependencies.toolContext.projectRoot,
        sessionId: state.dependencies.session.id,
        toolCallId: state.toolCall.id,
        output,
    });
    const preview = output.slice(0, Math.min(LARGE_TOOL_RESULT_PREVIEW_CHARS, limit));
    const renderedPath = renderPersistedOutputPath(persistedOutputPath, state.dependencies.toolContext.projectRoot);
    const projectedOutput = [
        `<persisted-output path="${escapeAttribute(renderedPath)}" original_chars="${output.length}" preview_chars="${preview.length}">`,
        preview,
        '</persisted-output>',
    ].join('\n');

    return {
        ...result,
        output: projectedOutput,
        metadata: {
            ...result.metadata,
            persistedOutputPath,
            originalOutputChars: output.length,
            previewedOutputChars: preview.length,
        },
    };
}

function persistToolOutput(input: {
    projectRoot: string;
    sessionId: string;
    toolCallId: string;
    output: string;
}): string {
    const outputDir = path.join(
        input.projectRoot,
        '.xqoder',
        'tool-results',
        sanitizePathSegment(input.sessionId),
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${sanitizePathSegment(input.toolCallId)}.txt`);
    fs.writeFileSync(outputPath, input.output, 'utf-8');
    return outputPath;
}

function renderPersistedOutputPath(outputPath: string, projectRoot: string): string {
    const relative = path.relative(projectRoot, outputPath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : outputPath;
}

function sanitizePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, '_') || 'unknown';
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
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
