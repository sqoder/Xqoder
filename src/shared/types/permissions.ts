export type AgentPermissionMode = 'allow' | 'ask' | 'deny';

export interface PermissionSettings {
    defaultMode?: AgentPermissionMode;
    tools?: Record<string, AgentPermissionMode>;
}
