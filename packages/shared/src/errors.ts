// ============================================================
// XQoder 统一错误定义
// ============================================================

/** XQoder 基础错误类 */
export class XQoderError extends Error {
    public readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'XQoderError';
        this.code = code;
    }
}

/** Agent 相关错误 */
export class AgentError extends XQoderError {
    constructor(message: string) {
        super(message, 'AGENT_ERROR');
        this.name = 'AgentError';
    }
}

/** LLM Provider 错误 */
export class LLMError extends XQoderError {
    public readonly provider: string;
    public readonly statusCode?: number;

    constructor(message: string, provider: string, statusCode?: number) {
        super(message, 'LLM_ERROR');
        this.name = 'LLMError';
        this.provider = provider;
        this.statusCode = statusCode;
    }
}

/** 工具执行错误 */
export class ToolError extends XQoderError {
    public readonly toolName: string;

    constructor(message: string, toolName: string) {
        super(message, 'TOOL_ERROR');
        this.name = 'ToolError';
        this.toolName = toolName;
    }
}

/** Runtime 运行错误 */
export class XQoderRuntimeError extends XQoderError {
    constructor(message: string) {
        super(message, 'RUNTIME_ERROR');
        this.name = 'XQoderRuntimeError';
    }
}

/** 部署错误 */
export class DeployError extends XQoderError {
    public readonly target: string;

    constructor(message: string, target: string) {
        super(message, 'DEPLOY_ERROR');
        this.name = 'DeployError';
        this.target = target;
    }
}

/** 工作流错误 */
export class WorkflowError extends XQoderError {
    public readonly stepName?: string;

    constructor(message: string, stepName?: string) {
        super(message, 'WORKFLOW_ERROR');
        this.name = 'WorkflowError';
        this.stepName = stepName;
    }
}

/** 配置错误 */
export class ConfigError extends XQoderError {
    constructor(message: string) {
        super(message, 'CONFIG_ERROR');
        this.name = 'ConfigError';
    }
}
