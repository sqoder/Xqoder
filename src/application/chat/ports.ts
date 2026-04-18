import type {
    AgentSession,
    AgentCallbacks,
} from '@xqoder/agent';
import type {
    LLMProviderConfig,
    LSPServerConfig,
    MCPServerConfig,
    MessageAttachment,
    SandboxSettings,
    ShellConfig,
} from '@xqoder/shared';

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
}

export interface ChatAgentInstance {
    run(prompt: string, callbacks?: AgentCallbacks, attachments?: MessageAttachment[]): Promise<string>;
    getSession(): AgentSession;
    dispose?: () => Promise<void> | void;
}
