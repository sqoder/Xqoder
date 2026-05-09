// ============================================================
// Tool System — Tool interfaces and registry
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SandboxMode, ToolDefinition, ToolResult } from '@xqoder/shared';
import { ToolError } from '@xqoder/shared';
import type { RollbackStore } from './rollback-store.js';
import { isSandboxAccessError } from './sandbox.js';
import type { MvpRuntimeConfig } from '../mvp/types.js';
import {
    mergeToolApprovalRequest,
    type McpToolOperation,
    type ToolApprovalPatch,
    type ToolApprovalRequest,
    type ToolApprovalRisk,
    type ToolSecurityPolicyContext,
    type ToolTrustLevel,
} from '../../../domain/permissions/index.js';

export type {
    McpToolOperation,
    ToolApprovalPatch,
    ToolApprovalRequest,
    ToolApprovalRisk,
    ToolSecurityPolicyContext,
    ToolTrustLevel,
};

export interface ToolStreamEvent {
    chunk: string;
    stream: 'stdout' | 'stderr';
}

export interface ToolFileReadState {
    path: string;
    fullFile: boolean;
    size: number;
    mtimeMs: number;
    readAt: string;
    toolCallId?: string;
    startLine?: number;
    endLine?: number;
}

export interface QuestionOption {
    label: string;
    description?: string;
}

export interface QuestionPrompt {
    requestId: string;
    question: string;
    header?: string;
    options: QuestionOption[];
    multiple?: boolean;
    allowCustom?: boolean;
}

export interface QuestionAnswer {
    requestId: string;
    selected: string[];
    customText?: string;
}

/** Tool execution context */
export interface ToolContext {
    /** Current working directory */
    cwd: string;
    /** Project root directory; all files and commands must be restricted within this directory */
    projectRoot: string;
    /** Sandbox permission mode */
    sandboxMode?: SandboxMode;
    /** Additional paths allowed for access */
    allowedPaths?: string[];
    /** Per-session read capabilities granted after approval for outside-workspace reads */
    approvedReadPaths?: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Shell configuration */
    shell?: { path?: string; args?: string[] };
    /** Current session ID */
    sessionId?: string;
    /** Tool approval request */
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
    /** Streaming tool output */
    onToolStream?: (event: ToolStreamEvent) => void;
    /** Structured question interaction */
    requestQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
    /** Rollback point storage */
    rollbackStore?: RollbackStore;
    /** MVP runtime configuration loaded from project/user rules */
    mvpRuntimeConfig?: MvpRuntimeConfig;
    /** Hook-injected approval patch or forced approval request */
    approvalRequestPatch?: ToolApprovalPatch;
    /** Per-session file read state used by read-before-write checks */
    fileReadState?: Map<string, ToolFileReadState>;
}

/**
 * Tool Interface
 * All tools must implement this interface
 */
export interface ITool {
    /** Tool definition (name, description, parameters) */
    readonly definition: ToolDefinition;

    /** Security metadata consumed by permission policy and capability filtering */
    getSecurityPolicyContext?(): ToolSecurityPolicyContext | undefined;

    /** Whether approval is required before execution */
    buildApprovalRequest?(
        args: Record<string, unknown>,
        context: ToolContext,
    ): ToolApprovalRequest | undefined | Promise<ToolApprovalRequest | undefined>;

    /** Whether this concrete invocation is read-only. Defaults to false. */
    isReadOnly?(args: Record<string, unknown>, context: ToolContext): boolean;

    /** Whether this concrete invocation can run concurrently with other safe calls. Defaults to false. */
    isConcurrencySafe?(args: Record<string, unknown>, context: ToolContext): boolean;

    /** Per-tool model-visible output cap before persistence/preview handling. */
    maxResultSizeChars?: number;

    /** Whether oversized outputs should be persisted and replaced with a preview. Defaults to true. */
    persistLargeResult?: boolean;

    /** Execute the tool */
    execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export function isToolInvocationReadOnly(
    tool: ITool | undefined,
    args: Record<string, unknown>,
    context: ToolContext,
): boolean {
    return tool?.isReadOnly?.(args, context) ?? false;
}

export function isToolInvocationConcurrencySafe(
    tool: ITool | undefined,
    args: Record<string, unknown>,
    context: ToolContext,
): boolean {
    return tool?.isConcurrencySafe?.(args, context) ?? false;
}

export function getToolResultSizeLimit(tool: ITool | undefined, defaultLimit: number): number {
    const limit = tool?.maxResultSizeChars;
    return Number.isFinite(limit) && typeof limit === 'number' && limit > 0
        ? limit
        : defaultLimit;
}

export function shouldPersistLargeToolResult(tool: ITool | undefined): boolean {
    return tool?.persistLargeResult !== false;
}

export function getFileReadStateMap(context: ToolContext): Map<string, ToolFileReadState> {
    if (!context.fileReadState) {
        context.fileReadState = new Map();
    }
    return context.fileReadState;
}

export function recordToolFileReadState(
    context: ToolContext,
    state: ToolFileReadState,
): void {
    getFileReadStateMap(context).set(path.resolve(state.path), {
        ...state,
        path: path.resolve(state.path),
    });
}

export function getToolFileReadState(
    context: ToolContext,
    filePath: string,
): ToolFileReadState | undefined {
    return getFileReadStateMap(context).get(path.resolve(filePath));
}

export function validateExistingFileWasFullyRead(
    filePath: string,
    context: ToolContext,
): string | undefined {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        return undefined;
    }

    const state = getToolFileReadState(context, resolvedPath);
    if (!state?.fullFile) {
        return `Existing file must be read fully with read_file before it can be modified: ${resolvedPath}`;
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size !== state.size || Math.abs(stat.mtimeMs - state.mtimeMs) > 1) {
        return `File changed since it was last read and must be read again before modification: ${resolvedPath}`;
    }

    return undefined;
}

/**
 * Tool Registry
 * Manages registration and retrieval of all available tools
 */
export class ToolRegistry {
    private tools: Map<string, ITool> = new Map();

    /** Register a tool */
    register(tool: ITool): void {
        if (this.tools.has(tool.definition.name)) {
            throw new ToolError(
                `Tool "${tool.definition.name}" is already registered`,
                tool.definition.name,
            );
        }
        this.tools.set(tool.definition.name, tool);
    }

    /** Register or replace a tool */
    upsert(tool: ITool): void {
        this.tools.set(tool.definition.name, tool);
    }

    /** Get a tool */
    get(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    /** Remove a tool */
    remove(name: string): boolean {
        return this.tools.delete(name);
    }

    /** Execute a tool */
    async execute(
        name: string,
        args: Record<string, unknown>,
        context: ToolContext,
        toolCallId: string,
    ): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Unknown tool: ${name}`,
            };
        }

        let approvalGranted = false;
        let approvalRequest: ToolApprovalRequest | undefined;
        try {
            const builtApprovalRequest = await tool.buildApprovalRequest?.(args, context);
            approvalRequest = mergeToolApprovalRequest(
                name,
                args,
                toolCallId,
                builtApprovalRequest,
                context.approvalRequestPatch,
            );
            if (approvalRequest && context.requestToolApproval) {
                approvalGranted = await context.requestToolApproval({
                    ...approvalRequest,
                    toolCallId,
                    toolName: name,
                });

                if (!approvalGranted) {
                    return {
                        toolCallId,
                        success: false,
                        output: '',
                        error: `Tool approval denied: ${name}`,
                        metadata: {
                            stopReason: 'permission_denied',
                        },
                    };
                }
            }

            return await tool.execute({
                ...args,
                toolCallId,
            }, context);
        } catch (err) {
            if (isSandboxAccessError(err) && context.requestToolApproval) {
                const sandboxApprovalRequest = createSandboxEscalationApprovalRequest(name, toolCallId, err);
                const approved = approvalGranted && approvalRequestCoversSandboxAccess(approvalRequest, err)
                    ? true
                    : await context.requestToolApproval(sandboxApprovalRequest);

                if (approved) {
                    const retryContext = shouldGrantNarrowReadAccess(tool, args, context)
                        ? {
                            ...context,
                            approvedReadPaths: grantApprovedReadPaths(context.approvedReadPaths, context.cwd, err.inputPath, err.resolvedPath),
                        }
                        : {
                            ...context,
                            sandboxMode: 'full-access' as const,
                        };
                    try {
                        return await tool.execute({
                            ...args,
                            toolCallId,
                        }, retryContext);
                    } catch (retryErr) {
                        return {
                            toolCallId,
                            success: false,
                            output: '',
                            error: shouldGrantNarrowReadAccess(tool, args, context)
                                ? `Tool "${name}" failed after retrying with approved read access: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
                                : `Tool "${name}" failed after retrying with full-access: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                        };
                    }
                }

                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Tool approval denied: ${name}`,
                    metadata: {
                        stopReason: 'permission_denied',
                    },
                };
            }

            if (isSandboxAccessError(err)) {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Tool "${name}" execution failed: ${err.message}`,
                };
            }

            return {
                toolCallId,
                success: false,
                output: '',
                error: `Tool "${name}" execution failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    /** Get all tool definitions (for sending to LLM) */
    getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    /** Get all registered tool instances */
    getTools(): ITool[] {
        return Array.from(this.tools.values());
    }

    /** Get registered tool count */
    get size(): number {
        return this.tools.size;
    }
}

function createSandboxEscalationApprovalRequest(
    toolName: string,
    toolCallId: string,
    error: {
        inputPath: string;
        resolvedPath: string;
        sandboxMode: SandboxMode;
    },
): ToolApprovalRequest {
    return {
        toolCallId,
        toolName,
        summary: `Request access to path outside project: ${error.inputPath}`,
        reason: 'Current operation requires access to files or directories outside the project directory.',
        preview: `resolved: ${error.resolvedPath}\nmode: ${error.sandboxMode}`,
        risk: 'high',
    };
}

function approvalRequestCoversSandboxAccess(
    request: ToolApprovalRequest | undefined,
    error: {
        inputPath: string;
        resolvedPath: string;
    },
): boolean {
    if (!request) {
        return false;
    }

    return [
        request.summary,
        request.reason,
        request.preview,
    ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .some((value) => value.includes(error.inputPath) || value.includes(error.resolvedPath));
}

function shouldGrantNarrowReadAccess(
    tool: ITool,
    args: Record<string, unknown>,
    context: ToolContext,
): boolean {
    return isToolInvocationReadOnly(tool, args, context);
}

function grantApprovedReadPaths(
    existingPaths: string[] | undefined,
    cwd: string,
    ...pathsToAdd: string[]
): string[] {
    const approvedPaths = existingPaths ?? [];
    for (const candidate of [
        ...pathsToAdd,
        ...pathsToAdd.map((entry) => path.resolve(cwd, entry)),
    ]) {
        const normalized = path.resolve(candidate);
        if (!approvedPaths.includes(normalized)) {
            approvedPaths.push(normalized);
        }
    }
    return approvedPaths;
}
