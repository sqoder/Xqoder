export type TaskMode =
    | 'casual_chat'
    | 'project_question'
    | 'plan_only'
    | 'engineering_edit'
    | 'debug_fix'
    | 'code_review';

export type ExecutionCapability = 'read_only' | 'plan' | 'workspace_write';

export type ApprovalPolicy =
    | 'strict'
    | 'balanced'
    | 'workspace_auto'
    | 'full_auto'
    | 'dangerous_full_access';

export type AgentPermissionMode = 'allow' | 'ask' | 'deny' | 'auto' | 'plan' | 'default' | 'bypassPermissions';

export interface PermissionSettings {
    defaultMode?: AgentPermissionMode;
    tools?: Record<string, AgentPermissionMode>;
    allowedTools?: string[];
    disallowedTools?: string[];
    approvalPolicy?: ApprovalPolicy;
}
