// ============================================================
// Tool System — 工具接口和注册表
// ============================================================

import type { SandboxMode, ToolDefinition, ToolResult } from '@xqoder/shared';
import { ToolError } from '@xqoder/shared';
import type { RollbackStore } from './rollback-store.js';
import { isSandboxAccessError } from './sandbox.js';

export type ToolApprovalRisk = 'low' | 'medium' | 'high';

export interface ToolApprovalRequest {
    toolCallId: string;
    toolName: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: ToolApprovalRisk;
}

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

/** 工具执行上下文 */
export interface ToolContext {
    /** 当前工作目录 */
    cwd: string;
    /** 项目根目录，所有文件与命令都必须限制在此目录内 */
    projectRoot: string;
    /** Sandbox 权限模式 */
    sandboxMode?: SandboxMode;
    /** 额外允许访问的路径 */
    allowedPaths?: string[];
    /** 环境变量 */
    env?: Record<string, string>;
    /** Shell 配置 */
    shell?: { path?: string; args?: string[] };
    /** 当前 session ID */
    sessionId?: string;
    /** 工具审批 */
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
    /** 流式工具输出 */
    onToolStream?: (event: ToolStreamEvent) => void;
    /** 结构化提问交互 */
    requestQuestion?: (prompt: QuestionPrompt) => Promise<QuestionAnswer>;
    /** 回滚点存储 */
    rollbackStore?: RollbackStore;
}

/**
 * Tool 接口
 * 所有工具都必须实现此接口
 */
export interface ITool {
    /** 工具定义（名称、描述、参数） */
    readonly definition: ToolDefinition;

    /** 是否需要在执行前请求审批 */
    buildApprovalRequest?(
        args: Record<string, unknown>,
        context: ToolContext,
    ): ToolApprovalRequest | undefined | Promise<ToolApprovalRequest | undefined>;

    /** 执行工具 */
    execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/**
 * 工具注册表
 * 管理所有可用工具的注册和查找
 */
export class ToolRegistry {
    private tools: Map<string, ITool> = new Map();

    /** 注册工具 */
    register(tool: ITool): void {
        if (this.tools.has(tool.definition.name)) {
            throw new ToolError(
                `工具 "${tool.definition.name}" 已注册`,
                tool.definition.name,
            );
        }
        this.tools.set(tool.definition.name, tool);
    }

    /** 注册或替换工具 */
    upsert(tool: ITool): void {
        this.tools.set(tool.definition.name, tool);
    }

    /** 获取工具 */
    get(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    /** 删除工具 */
    remove(name: string): boolean {
        return this.tools.delete(name);
    }

    /** 执行工具 */
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
                error: `未知工具: ${name}`,
            };
        }

        try {
            const approvalRequest = await tool.buildApprovalRequest?.(args, context);
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
                        error: `工具审批被拒绝: ${name}`,
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
                    summary: `请求访问项目外路径: ${err.inputPath}`,
                    reason: '当前操作需要访问项目目录之外的文件或目录。',
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
                            error: `工具 "${name}" 在 full-access 重试后仍失败: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
                        };
                    }
                }

                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `工具审批被拒绝: ${name}`,
                };
            }

            return {
                toolCallId,
                success: false,
                output: '',
                error: `工具 "${name}" 执行失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }

    /** 获取所有工具定义（用于发送给 LLM） */
    getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    /** 获取已注册工具数量 */
    get size(): number {
        return this.tools.size;
    }
}
