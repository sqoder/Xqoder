// ============================================================
// Tool System — Tool interfaces and registry
// ============================================================

import type { SandboxMode, ToolDefinition, ToolResult } from '@xqoder/shared';
import { ToolError } from '@xqoder/shared';
import type { RollbackStore } from './rollback-store.js';
import { isSandboxAccessError } from './sandbox.js';
import {
    mergeToolApprovalRequest,
    type ToolApprovalPatch,
    type ToolApprovalRequest,
    type ToolApprovalRisk,
} from '../../../domain/permissions/index.js';

export type {
    ToolApprovalPatch,
    ToolApprovalRequest,
    ToolApprovalRisk,
};

export interface ToolStreamEvent {
    chunk: string;
    stream: 'stdout' | 'stderr';
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
    /** Hook-injected approval patch or forced approval request */
    approvalRequestPatch?: ToolApprovalPatch;
}

/**
 * Tool Interface
 * All tools must implement this interface
 */
export interface ITool {
    /** Tool definition (name, description, parameters) */
    readonly definition: ToolDefinition;

    /** Whether approval is required before execution */
    buildApprovalRequest?(
        args: Record<string, unknown>,
        context: ToolContext,
    ): ToolApprovalRequest | undefined | Promise<ToolApprovalRequest | undefined>;

    /** Execute the tool */
    execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
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

        try {
            const builtApprovalRequest = await tool.buildApprovalRequest?.(args, context);
            const approvalRequest = mergeToolApprovalRequest(
                name,
                args,
                toolCallId,
                builtApprovalRequest,
                context.approvalRequestPatch,
            );
            if (approvalRequest && context.requestToolApproval) {
                const approved = await context.requestToolApproval({
                    ...approvalRequest,
                    toolCallId,
                    toolName: name,
                });

                if (!approved) {
                    return {
                        toolCallId,
                        success: false,
                        output: '',
                        error: `Tool approval denied: ${name}`,
                    };
                }
            }

            return await tool.execute({
                ...args,
                toolCallId,
            }, context);
        } catch (err) {
            if (isSandboxAccessError(err) && context.requestToolApproval) {
                const approved = await context.requestToolApproval({
                    toolCallId,
                    toolName: name,
                    summary: `Request access to path outside project: ${err.inputPath}`,
                    reason: 'Current operation requires access to files or directories outside the project directory.',
                    preview: `resolved: ${err.resolvedPath}\nmode: ${err.sandboxMode}`,
                    risk: 'high',
                });

                if (approved) {
                    try {
                        return await tool.execute({
                            ...args,
                            toolCallId,
                        }, {
                            ...context,
                            sandboxMode: 'full-access',
                        });
                    } catch (retryErr) {
                        return {
                            toolCallId,
                            success: false,
                            output: '',
                            error: `Tool "${name}" failed after retrying with full-access: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                        };
                    }
                }

                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Tool approval denied: ${name}`,
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

    /** Get registered tool count */
    get size(): number {
        return this.tools.size;
    }
}
