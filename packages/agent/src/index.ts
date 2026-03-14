// ============================================================
// @xqoder/agent — 统一导出
// ============================================================

export { XQoderAgent, type AgentConfig, type AgentCallbacks } from './agent.js';
export { DEFAULT_SYSTEM_PROMPT } from './agent.js';
export { createLLMProvider } from './agent.js';
export {
    XQoderAgentProvider,
    createXQoderAgentProvider,
    type AgentConfigResolver,
    type XQoderAgentProviderOptions,
} from './agent-provider.js';
export {
    buildAgentConfigFromXQoderConfig,
    getBuiltInAgentDefinition,
    listBuiltInAgents,
    resolveAgentRuntimeConfig,
    type BuiltInAgentDefinition,
    type ResolvedAgentRuntimeConfig,
} from './agents.js';
export { type ILLMProvider, BaseLLMProvider, type CompletionRequest, type CompletionResponse } from './llm/provider.js';
export { OpenAIProvider } from '@xqoder/provider-openai';
export { AnthropicProvider } from '@xqoder/provider-anthropic';
export { DashScopeProvider } from './llm/dashscope.js';
export { GeminiProvider } from './llm/gemini.js';
export { AzureOpenAIProvider } from './llm/azure.js';
export { BedrockProvider } from './llm/bedrock.js';
export { CopilotProvider } from './llm/copilot.js';
export { VertexAIProvider } from './llm/vertexai.js';
export { GroqProvider } from './llm/groq.js';
export { OpenRouterProvider } from './llm/openrouter.js';
export { LocalProvider } from './llm/local.js';
export { XAIProvider } from './llm/xai.js';
export {
    SummarizerAgent,
    TitleAgent,
    TaskAgent,
    createSubAgents,
    type SubAgents,
    type AgentName,
} from './sub-agents.js';
export {
    McpServerManager,
    inspectMcpServers,
    type McpServerInspection,
} from './mcp.js';
export {
    type CompletionMatch,
    type HoverMatch,
    ExternalLanguageServerManager,
    type RenameMatch,
    type TextEditMatch,
    inspectLspServers,
    type DiagnosticMatch,
    type LocationMatch,
    type LspServerInspection,
    type WorkspaceSymbolMatch,
} from './lsp.js';
export { type ITool, ToolRegistry, type ToolContext } from './tools/tool.js';
export { type ToolApprovalRequest, type ToolApprovalRisk, type ToolStreamEvent } from './tools/tool.js';
export { ReadFileTool, WriteFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
export { SourcegraphTool, type SourcegraphParams } from './tools/sourcegraph-tool.js';
export { ListFilesTool, GlobFilesTool, GrepContentTool } from './tools/discovery-tools.js';
export {
    LspCompletionTool,
    createDefaultLspTools,
    LspHoverTool,
    LspWorkspaceSymbolsTool,
    LspFileDiagnosticsTool,
    LspDefinitionTool,
    LspRenameSymbolTool,
    LspReferencesTool,
} from './tools/lsp-tools.js';
export { RunCommandTool, InstallPackageTool } from './tools/command-tool.js';
export { SkillTool, TodoWriteTool, TodoReadTool, QuestionTool } from './tools/interaction-tools.js';
export { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
export { FetchUrlTool, WebSearchTool } from './tools/fetch-tool.js';
export { DiagnosticsTool, type DiagnosticsProvider } from './tools/diagnostics-tool.js';
export {
    FileRollbackStore,
    type RollbackPoint,
    type RollbackPointDetails,
    type RollbackSnapshotFile,
    type RollbackStore,
} from './tools/rollback-store.js';
export { resolvePathWithinProject, resolveWorkingDirectory, validateCommandSafety } from './tools/sandbox.js';
export {
    AgentSession,
    normalizeSessionMetadataSnapshot,
    type AgentCommandHistoryEntry,
    type AgentFileChangeEntry,
    type AgentSessionCompaction,
    type AgentSessionMetadataSnapshot,
    type AgentSessionSnapshot,
    type AgentSessionUsage,
    type AgentToolExecution,
} from './session/session.js';
export {
    SQLiteSessionStore,
    type AgentSessionStore,
    type PersistedSessionSummary,
    type SaveSessionInput,
    type SaveSessionOptions,
} from './session/store.js';
export {
    PermissionManager,
    type PermissionRequest,
    type PermissionDecision,
    type PermissionPolicy,
} from './permission.js';
export {
    OpenClawClient,
    createOpenClawClient,
    createOpenClawClientFromEnv,
    type OpenClawConfig,
    type OpenClawChannel,
    type OpenClawMessage,
    type OpenClawResponse,
    type OpenClawPlugin,
    type OpenClawMemoryEntry,
} from './openclaw.js';
export { DelegateTaskTool } from './tools/agent-tool.js';
export { LspFileWatcher, type LspWatcherOptions } from './lsp-watcher.js';
export {
    runMigrations,
    getCurrentVersion,
    getLatestMigrationVersion,
    getPendingMigrations,
    type Migration,
} from './session/migrations.js';
export {
    DiskFileHistoryStore,
    type FileVersion,
    type FileHistoryStore,
} from './session/file-history.js';
