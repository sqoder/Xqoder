// ============================================================
// @xqoder/agent — Unified Exports
// ============================================================

export { XQoderAgent, type AgentConfig, type AgentCallbacks } from './agent.js';
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_MVP_SYSTEM_PROMPT } from './agent.js';
export { createLLMProvider } from './llm/factory.js';
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
export {
    getMarkdownAgentDefinition,
    listMarkdownAgents,
    type MarkdownAgentDefinition,
    type MarkdownAgentSource,
} from './markdown-agents.js';
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
    createStandaloneMcpClient,
    McpServerManager,
    inspectMcpServers,
    type McpServerInspection,
} from './mcp.js';
export {
    buildAuthorizeUrl,
    createMcpAuthProvider,
    exchangeAuthCode,
    FileMcpTokenStore,
    generatePkcePair,
    generateState,
    McpAuthTool,
    oauthDisabled,
    refreshAccessToken,
    runMcpOauth,
} from './mcp.js';
export type {
    McpAuthProvider,
    McpAuthToolOptions,
    McpCallToolResult,
    McpClientAdapter,
    McpGetPromptResult,
    McpPromptArgumentDescriptor,
    McpPromptDescriptor,
    McpReadResourceResult,
    McpResourceDescriptor,
    McpResourceTemplateDescriptor,
    McpServerInfo,
    McpToolDescriptor,
    McpTokenStore,
    RunMcpOauthOptions,
    StoredMcpToken,
} from './mcp.js';
export {
    type CompletionMatch,
    type HoverMatch,
    type RenameMatch,
    type TextEditMatch,
    inspectLspServers,
    type DiagnosticMatch,
    type LocationMatch,
    type LspServerInspection,
    type WorkspaceSymbolMatch,
} from './lsp.js';
export { ExternalLanguageServerManager } from './lsp-manager.js';
export { type ITool, ToolRegistry, type ToolContext } from './tools/tool.js';
export { type ToolApprovalRequest, type ToolApprovalRisk, type ToolStreamEvent } from './tools/tool.js';
export {
    runToolHooks,
    buildPreToolUseHookPayload,
    buildPostToolUseHookPayload,
    buildPostToolUseFailureHookPayload,
    formatHookFeedbackSection,
    type HookPayloadBase,
    type HookRunnerConfigBase,
    type ToolHookEventName,
    type ToolHookPayload,
    type ToolHookRunnerConfig,
    type ToolHookExecutionResult,
} from './hooks.js';
export {
    dispatchLifecycleHook,
    dispatchLifecycleHookFireAndForget,
    buildSessionStartPayload,
    buildSessionEndPayload,
    buildStopPayload,
    buildSubagentStopPayload,
    buildPreCompactPayload,
    buildPostCompactPayload,
    type LifecycleHookEventName,
    type LifecycleHookPayload,
    type LifecycleHookResult,
    type SessionStartHookPayload,
    type SessionEndHookPayload,
    type StopHookPayload,
    type SubagentStopHookPayload,
    type PreCompactHookPayload,
    type PostCompactHookPayload,
} from './lifecycle-hooks.js';
export { ReadFileTool, WriteFileTool, EditFileTool, PreviewDiffTool, SearchCodeTool } from './tools/file-tools.js';
export {
    ReadAnyFileTool,
    readAnyFile,
    renderFileAnalysis,
    type FileAnalysisResult,
    type FileKind,
    type ReadAnyFileInput,
} from './tools/read-any-file/index.js';
export { SourcegraphTool, type SourcegraphParams } from './tools/sourcegraph-tool.js';
export { ListFilesTool, GlobFilesTool, GrepContentTool, DiscoverSkillsTool } from './tools/discovery-tools.js';
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
export { RunCommandTool, RunShellTool, InstallPackageTool } from './tools/command-tool.js';
export { SkillTool, TodoWriteTool, TodoReadTool, QuestionTool } from './tools/interaction-tools.js';
export { ApplyPatchTool, RestoreRollbackPointTool } from './tools/patch-tool.js';
export { FetchUrlTool, WebSearchTool } from './tools/fetch-tool.js';
export { InspectGitHubRepoTool } from './tools/github-repo-tool.js';
export { parseGitHubRepositoryUrl, isGitHubRepositoryUrl } from './github-repo-url.js';
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
    type AgentCheckpointRecord,
    type AgentConversationEventStoreRecord,
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
export { partitionToolCalls, type ToolBatch, type PartitionOptions } from './tools/partition.js';
export { runToolBatches, type ToolBatchExecutionContext } from './tools/streaming-executor.js';
export {
    createAutoFixRunner,
    type AutoFixCheckResult,
    type AutoFixExecutedTool,
    type AutoFixOutcome,
    type AutoFixRunner,
    type AutoFixRunnerOptions,
    type AutoFixRunInput,
} from './tools/auto-fix-runner.js';
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
export * from './protocol.js';
export { EventSession } from './session/event-session.js';
export { MvpRuntimeController } from './mvp/orchestrator.js';
export {
    classifyMvpTask,
    extractCandidatePaths,
} from './mvp/task-classifier.js';
export { collectMvpContext } from './mvp/context-collector.js';
export { shapeMvpContext } from './mvp/context-shaper.js';
export {
    calculateMvpFreshness,
    orderMvpContextSections,
    scoreMvpContextSections,
    sortMvpSectionsForCompression,
} from './mvp/freshness.js';
export { planMvpTurn, renderMvpPlannerPrompt } from './mvp/planner.js';
export {
    captureMvpTestBaseline,
    compareMvpTestBaselines,
    detectMvpTestCommand,
    formatMvpBaselineSignal,
} from './mvp/baseline.js';
export { distillMvpVerifierOutput } from './mvp/distiller.js';
export { runMvpVerification, formatMvpVerificationMessage } from './mvp/verifier.js';
export { decideMvpRecovery, formatMvpRecoveryMessage, classifyMvpFailure } from './mvp/recovery.js';
export {
    MvpFailurePatternMemory,
    normalizeMvpFailureSignature,
} from './mvp/pattern-memory.js';
export { resolveMvpRecoveryDecision, applyMvpRecoveryDecision, renderMvpRecoveryMessage } from './mvp/recovery-manager.js';
export {
    applyToolResultBudget,
    snipCompactIfNeeded,
    microcompact,
    nextReactiveStep,
    applyReactiveStep,
    TOOL_RESULT_MAX_BYTES,
    SNIP_THRESHOLD_BYTES,
    MICRO_PAIRS_THRESHOLD,
    type ReactiveStep,
    type ReactiveSessionTarget,
    type ToolResultTruncation,
} from './session/compaction/index.js';
export { PromptTooLongError } from '../../infra/llm/retry/index.js';
export { loadMvpRuntimeConfig } from './mvp/runtime-config.js';
export {
    createMvpBaselineCheck,
    createMvpOutputCheck,
    createMvpStopCheck,
    evaluateMvpStopConditions,
    formatMvpStopEvaluationMessage,
    isMvpStopConditionSatisfied,
} from './mvp/stop-condition.js';
export type {
    AgentRuntimeProfile,
    MvpBaselineSignal,
    MvpBaselineStatus,
    MvpCollectedContext,
    MvpContextSection,
    MvpContextTier,
    MvpDistilledResult,
    MvpFailureClassification,
    MvpFailurePattern,
    MvpPlannerAction,
    MvpPlannerDecision,
    MvpProjectRule,
    MvpRecoveryAction,
    MvpRecoveryDecision,
    MvpRuntimeConfig,
    MvpShapedContext,
    MvpStopConditionConfig,
    MvpStopEvaluationResult,
    MvpTaskType,
    MvpTestBaseline,
    MvpVerificationLocation,
    MvpVerificationCheckResult,
    MvpVerificationResult,
    MvpVerifierRawOutput,
    MvpVerifierType,
} from './mvp/types.js';
