import type {
    AgentSession,
    AgentCallbacks,
} from '@xqoder/agent';
import type {
    ApprovalPolicy,
    ExecutionCapability,
    LLMProviderConfig,
    LSPServerConfig,
    MCPServerConfig,
    MessageAttachment,
    PermissionSettings,
    SandboxSettings,
    ShellConfig,
    TaskMode,
} from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

export interface ChatSessionStore {
    findLatestSession(projectRoot: string): AgentSession | null;
    getSession(sessionId: string): AgentSession | null;
    saveSession(input: {
        session: AgentSession;
        projectRoot: string;
        cwd: string;
        model: string;
    }): {
        id: string;
        title?: string;
    };
}

export interface ChatAgentFactoryConfig {
    llmConfig: LLMProviderConfig;
    cwd: string;
    projectRoot: string;
    systemPrompt: string;
    sandboxMode: SandboxSettings['mode'];
    allowedPaths: string[];
    shell?: ShellConfig;
    mcpServers?: MCPServerConfig[];
    lspServers?: LSPServerConfig[];
    session?: AgentSession;
    sessionTitle?: string;
    autoApproveTools?: boolean;
    permissions?: PermissionSettings;
    taskMode?: TaskMode;
    executionCapability?: ExecutionCapability;
    approvalPolicy?: ApprovalPolicy;
    runtimeProfile?: 'mvp' | 'full' | 'hybrid';
}

export interface ChatVisibleTool {
    name: string;
    description?: string;
    permissionMode: string;
}

export interface ChatAgentInstance {
    run(prompt: string, callbacks?: AgentCallbacks, attachments?: MessageAttachment[]): Promise<string>;
    streamTurn?(
        prompt: string,
        callbacks?: AgentCallbacks,
        attachments?: MessageAttachment[],
    ): AsyncIterable<ConversationEventEnvelope>;
    listVisibleTools?(): Promise<ChatVisibleTool[]>;
    getSession(): AgentSession;
    dispose?: () => Promise<void> | void;
}
