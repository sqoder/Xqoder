// ============================================================
// XQoder Unified Error Definitions
// ============================================================

/** XQoder Base Error Class */
export class XQoderError extends Error {
    public readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'XQoderError';
        this.code = code;
    }
}

/** Agent Related Errors */
export class AgentError extends XQoderError {
    constructor(message: string) {
        super(message, 'AGENT_ERROR');
        this.name = 'AgentError';
    }
}

/** LLM Provider Errors */
export class LLMError extends XQoderError {
    public readonly provider: string;
    public readonly statusCode?: number;

    constructor(message: string, provider: string, statusCode?: number) {
        super(message, 'LLM_ERROR');
        this.name = 'LLMError';
        this.provider = provider;
        if (statusCode !== undefined) {
            this.statusCode = statusCode;
        }
    }
}

/** Tool Execution Errors */
export class ToolError extends XQoderError {
    public readonly toolName: string;

    constructor(message: string, toolName: string) {
        super(message, 'TOOL_ERROR');
        this.name = 'ToolError';
        this.toolName = toolName;
    }
}

/** Runtime Execution Errors */
export class XQoderRuntimeError extends XQoderError {
    constructor(message: string) {
        super(message, 'RUNTIME_ERROR');
        this.name = 'XQoderRuntimeError';
    }
}

/** Deployment Errors */
export class DeployError extends XQoderError {
    public readonly target: string;

    constructor(message: string, target: string) {
        super(message, 'DEPLOY_ERROR');
        this.name = 'DeployError';
        this.target = target;
    }
}

/** Workflow Errors */
export class WorkflowError extends XQoderError {
    public readonly stepName?: string;

    constructor(message: string, stepName?: string) {
        super(message, 'WORKFLOW_ERROR');
        this.name = 'WorkflowError';
        if (stepName !== undefined) {
            this.stepName = stepName;
        }
    }
}

/** Configuration Errors */
export class ConfigError extends XQoderError {
    constructor(message: string) {
        super(message, 'CONFIG_ERROR');
        this.name = 'ConfigError';
    }
}
