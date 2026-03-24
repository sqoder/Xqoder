// ---- 工具定义类型 ----

/** 工具调用请求 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}

/** 工具执行结果 */
export interface ToolResult {
    toolCallId: string;
    success: boolean;
    output: string;
    error?: string;
    metadata?: Record<string, unknown>;
}

/** 工具参数 schema */
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required?: boolean;
    default?: unknown;
}

/** 工具定义 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameter[];
}
