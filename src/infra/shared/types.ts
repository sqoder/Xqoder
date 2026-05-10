// ============================================================
// XQoder Shared Types
// ============================================================

// ---- Project-related types ----

/** Project type enum */
export enum ProjectType {
    Node = 'node',
    Python = 'python',
    Docker = 'docker',
    Go = 'go',
    Static = 'static',
    Unknown = 'unknown',
}

/** Project configuration */
export interface ProjectConfig {
    /** Project root directory */
    rootDir: string;
    /** Project type */
    type: ProjectType;
    /** Project name */
    name: string;
    /** Entry point file */
    entryPoint?: string;
    /** Start command */
    startCommand?: string;
    /** Development port */
    port?: number;
    /** Environment variables */
    env?: Record<string, string>;
}

/** Node project package manager */
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';

// ---- Runtime related types ----

/** Runtime execution status */
export enum RuntimeStatus {
    Idle = 'idle',
    Starting = 'starting',
    Running = 'running',
    Error = 'error',
    Stopped = 'stopped',
}

/** Standardized run report */
export interface RunReport {
    status: RuntimeStatus;
    /** Project directory */
    projectDir: string;
    /** Project type */
    projectType: ProjectType;
    /** Detected framework */
    framework?: string;
    /** Package manager */
    packageManager?: PackageManager;
    /** Actual executed command */
    command?: string;
    /** Actual port */
    port?: number;
    /** Running URL (e.g. http://localhost:3000) */
    url?: string;
    /** Process PID */
    pid?: number;
    /** Error information */
    errors: RuntimeError[];
    /** Log output */
    logs: string[];
    /** Start time */
    startedAt: Date;
    /** Completion time */
    completedAt?: Date;
}

/** Runtime execution result */
export type RuntimeResult = RunReport;

/** Runtime error */
export interface RuntimeError {
    type: RuntimeErrorType;
    message: string;
    /** Error source file */
    file?: string;
    /** Error line number */
    line?: number;
    /** Original stack trace */
    stack?: string;
    /** Suggested fix */
    suggestion?: string;
}

/** Runtime error type */
export enum RuntimeErrorType {
    DependencyMissing = 'dependency_missing',
    CompileError = 'compile_error',
    RuntimeException = 'runtime_exception',
    PortConflict = 'port_conflict',
    PermissionDenied = 'permission_denied',
    ConfigError = 'config_error',
    Unknown = 'unknown',
}

// ---- Test related types ----

/** Test status */
export enum TestStatus {
    Pending = 'pending',
    Running = 'running',
    Passed = 'passed',
    Failed = 'failed',
    Skipped = 'skipped',
}

/** Standardized test failure information */
export interface TestFailure {
    message: string;
    testName?: string;
    file?: string;
}

/** Standardized test report */
export interface TestReport {
    status: TestStatus;
    /** Project directory */
    projectDir: string;
    /** Package manager */
    packageManager?: PackageManager;
    /** Actual executed command */
    command?: string;
    /** Combined stdout and stderr results */
    output: string;
    /** Passed count */
    passed: number;
    /** Failed count */
    failed: number;
    /** Skipped count */
    skipped: number;
    /** Structured failure summary */
    failures: TestFailure[];
    /** Start time */
    startedAt: Date;
    /** Completion time */
    completedAt?: Date;
}

// ---- Deploy related types ----

/** Deployment target platform */
export enum DeployTarget {
    Vercel = 'vercel',
    Cloudflare = 'cloudflare',
    AWS = 'aws',
    Custom = 'custom',
}

/** Deployment status */
export enum DeployStatus {
    Pending = 'pending',
    Building = 'building',
    Deploying = 'deploying',
    Ready = 'ready',
    Failed = 'failed',
}

/** Standardized deployment report */
export interface DeployReport {
    status: DeployStatus;
    /** Project directory */
    projectDir: string;
    /** Build command */
    buildCommand?: string;
    /** Output directory */
    outputDir?: string;
    /** Deployed URL */
    url?: string;
    /** Deployment target */
    target: DeployTarget;
    /** Deployment ID */
    deployId?: string;
    /** Error information */
    error?: string;
    /** Deployment start time */
    startedAt: Date;
    /** Deployment completion time */
    completedAt?: Date;
}

/** Deployment result */
export type DeployResult = DeployReport;

/** Deployment configuration */
export interface DeployConfig {
    target: DeployTarget;
    /** Project directory */
    projectDir: string;
    /** Project name */
    projectName?: string;
    /** Vercel team or personal scope */
    scope?: string;
    /** Build command */
    buildCommand?: string;
    /** Output directory */
    outputDir?: string;
    /** Environment variables */
    env?: Record<string, string>;
    /** Platform specific configuration */
    platformConfig?: Record<string, unknown>;
}

// ---- Agent / LLM related types ----

/** LLM message roles */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM message */
export interface LLMMessage {
    role: MessageRole;
    content: string;
    /** Tool call ID (used for 'tool' role) */
    toolCallId?: string;
    /** Tool call request (used for 'assistant' role) */
    toolCalls?: ToolCall[];
    /** Thinking/Reasoning content (produced by extended thinking models) */
    thinking?: string;
    /** Binary content (images, etc.) */
    attachments?: MessageAttachment[];
    /** Structured content fragments (optional, backward compatible with content) */
    parts?: ContentPart[];
}

/** Message attachment */
export interface MessageAttachment {
    type: 'image' | 'file';
    mimeType: string;
    /** Base64 encoded data */
    data?: string;
    /** File path (local) */
    filePath?: string;
    /** URL (remote) */
    url?: string;
    fileName?: string;
}

export interface LLMInputModalities {
    image?: boolean;
    pdf?: boolean;
    audio?: boolean;
    video?: boolean;
}

// ---- Structured message content types (XQoder internal) ----

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';

export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; toolCall: ToolCall }
    | { type: 'tool_result'; toolCallId: string; output: string; success: boolean }
    | { type: 'image'; mimeType: string; data?: string; url?: string }
    | { type: 'finish'; reason: FinishReason };

/** Extract plain text from ContentPart array */
export function getTextContent(parts: ContentPart[]): string {
    return parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
}

/** Extract thinking content from ContentPart array */
export function getReasoningContent(parts: ContentPart[]): string {
    return parts.filter(p => p.type === 'reasoning').map(p => (p as { text: string }).text).join('');
}

/** Extract tool calls from ContentPart array */
export function getToolCallParts(parts: ContentPart[]): ToolCall[] {
    return parts
        .filter(p => p.type === 'tool_call')
        .map(p => (p as { type: 'tool_call'; toolCall: ToolCall }).toolCall);
}

/** Tool call request */
export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}

/** Tool execution result */
export interface ToolResult {
    toolCallId: string;
    success: boolean;
    output: string;
    error?: string;
    metadata?: Record<string, unknown>;
    /** Binary attachments produced by the tool, such as rendered PDF pages. */
    attachments?: MessageAttachment[];
}

/** LLM Provider configuration */
export type LLMProviderName = 'openai' | 'anthropic' | 'dashscope' | 'gemini' | 'openai-compatible' | 'azure' | 'bedrock' | 'copilot' | 'vertexai' | 'groq' | 'openrouter' | 'local' | 'xai';

/** LLM Provider configuration */
export interface LLMProviderConfig {
    provider: LLMProviderName;
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
    modalities?: LLMInputModalities;
}

/** LLM streaming callbacks */
export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onThinkingToken?: (token: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onComplete?: (message: LLMMessage) => void;
    onError?: (error: Error) => void;
}

// ---- Tool definition types ----

/** Tool parameter schema */
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required?: boolean;
    default?: unknown;
}

/** Tool definition */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameter[];
}

// ---- Workflow related types ----

/** Workflow status */
export enum WorkflowStatus {
    Pending = 'pending',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Failed = 'failed',
}

/** Workflow step status */
export enum StepStatus {
    Pending = 'pending',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
    Skipped = 'skipped',
    RolledBack = 'rolled_back',
}

/** Workflow step result */
export interface StepResult {
    stepName: string;
    status: StepStatus;
    output?: string;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
}

/** Workflow execution context */
export interface WorkflowContext {
    /** Project configuration */
    projectConfig: ProjectConfig;
    /** Original user request */
    userRequest: string;
    /** Results for each step */
    stepResults: StepResult[];
    /** Shared data (passed between steps) */
    data: Record<string, unknown>;
}

// ---- XQoder Global Config ----

/** Vercel configuration */
export interface VercelSettings {
    /** Default deployment scope */
    scope?: string;
}

/** Sandbox permission mode */
export type SandboxMode = 'project' | 'paths' | 'full-access';

/** Sandbox configuration */
export interface SandboxSettings {
    /** Permission mode */
    mode: SandboxMode;
    /** List of additional allowed paths */
    allowedPaths: string[];
}

/** Provider persistence settings */
export interface ProviderSettings {
    /** API Key */
    apiKey?: string;
    /** Provider default model */
    defaultModel?: string;
    /** Provider Base URL */
    baseUrl?: string;
    /** Default max tokens */
    maxTokens?: number;
    /** Default temperature */
    temperature?: number;
    /** Supported native input modalities for this provider/model */
    modalities?: LLMInputModalities;
    /** Whether it is disabled */
    disabled?: boolean;
}

/** Provider settings map */
export type ProviderSettingsMap = Partial<Record<LLMProviderName, ProviderSettings>>;

/** Agent mode */
export type AgentMode = 'primary' | 'subagent';

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

/** Agent permission mode */
export type AgentPermissionMode =
    | 'allow'
    | 'ask'
    | 'deny'
    | 'auto'
    | 'plan'
    | 'default'
    | 'bypassPermissions'
    | 'acceptEdits';

/** Agent model reference */
export interface LLMModelReference {
    provider?: LLMProviderName;
    model: string;
}

/** Agent settings */
export interface AgentSettings {
    /** primary / subagent */
    mode?: AgentMode;
    /** Which provider to use */
    provider?: LLMProviderName;
    /** Default model for this agent */
    model?: string;
    /** Override max tokens */
    maxTokens?: number;
    /** Override temperature */
    temperature?: number;
    /** Append to system prompt */
    prompt?: string;
    /** Additional instructions */
    instructions?: string[];
    /** Limit available tools */
    tools?: string[];
    /** Default working directory for this agent */
    cwd?: string;
    /** Permission mode */
    permissionMode?: AgentPermissionMode;
    /** Whether it is disabled */
    disabled?: boolean;
    /** Whether to prioritize using small model */
    useSmallModel?: boolean;
}

/** Agent settings map */
export type AgentSettingsMap = Record<string, AgentSettings>;

/** Custom command settings */
export interface CommandTemplateSettings {
    description?: string;
    prompt: string;
    agent?: string;
}

/** Permission configuration */
export interface PermissionSettings {
    /** Default permission policy */
    defaultMode?: AgentPermissionMode;
    /** Per-tool override */
    tools?: Record<string, AgentPermissionMode>;
    /** Explicitly allowed tools */
    allowedTools?: string[];
    /** Explicitly disallowed tools */
    disallowedTools?: string[];
    /** Approval policy for task-scoped permission gate */
    approvalPolicy?: ApprovalPolicy;
}

export const SUPPORTED_HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit'] as const;

export type HookEventName = typeof SUPPORTED_HOOK_EVENTS[number];

export function isHookEventName(value: string): value is HookEventName {
    return (SUPPORTED_HOOK_EVENTS as readonly string[]).includes(value);
}

export type HookHandlerType = 'command' | 'http' | 'prompt' | 'agent';

interface BaseHookHandlerConfig {
    type: HookHandlerType;
    timeout?: number;
}

export interface CommandHookHandlerConfig extends BaseHookHandlerConfig {
    type: 'command';
    command: string;
    async?: boolean;
    shell?: string;
}

export interface HttpHookHandlerConfig extends BaseHookHandlerConfig {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
}

export interface PromptHookHandlerConfig extends BaseHookHandlerConfig {
    type: 'prompt';
    prompt: string;
    model?: string;
}

export interface AgentHookHandlerConfig extends BaseHookHandlerConfig {
    type: 'agent';
    prompt: string;
    agent?: string;
    model?: string;
}

export type HookHandlerConfig =
    | CommandHookHandlerConfig
    | HttpHookHandlerConfig
    | PromptHookHandlerConfig
    | AgentHookHandlerConfig;

export interface HookMatcherConfig {
    matcher?: string;
    hooks: HookHandlerConfig[];
}

export type HooksSettings = Partial<Record<HookEventName, HookMatcherConfig[]>>;

/** Sharing mode (XQoder style) */
export type ShareMode = 'manual' | 'auto' | 'disabled';

/** Auto-update configuration */
export type AutoupdateMode = true | false | 'notify';

/** Server configuration (for serve/web) */
export interface ServerConfig {
    port?: number;
    hostname?: string;
    mdns?: boolean;
    mdnsDomain?: string;
    cors?: string[];
}

/** TUI keybinds configuration (XQoder style) */
export interface TuiKeybindsConfig {
    leader?: string;
    [key: string]: string | undefined;
}

/** tui.json standalone configuration (XQoder style) */
export interface TuiConfig {
    theme?: string;
    keybinds?: TuiKeybindsConfig;
    scroll_speed?: number;
    scroll_acceleration?: { enabled?: boolean };
    diff_style?: 'auto' | 'stacked';
}

/** MCP Server configuration */
export type MCPServerTrustLevel = 'trusted' | 'untrusted';

export interface MCPServerConfig {
    /** Config name, used for CLI and tool prefixes */
    name: string;
    /** Transport method, default is stdio */
    transport?: 'stdio' | 'http' | 'sse';
    /** Start command in stdio mode */
    command?: string;
    /** Arguments passed to the command */
    args?: string[];
    /** Additional environment variables */
    env?: Record<string, string>;
    /** Process working directory */
    cwd?: string;
    /** Target URL in http/sse mode */
    url?: string;
    /** Request headers in http/sse mode */
    headers?: Record<string, string>;
    /** Trust level used by permission policy; defaults by transport */
    trust?: MCPServerTrustLevel;
    /** Whether it is enabled */
    enabled?: boolean;
    /** Timeout for a single request in milliseconds */
    timeoutMs?: number;
    /** Optional OAuth 2.1 config for http/sse transports */
    oauth?: MCPServerOAuthConfig;
}

/** OAuth 2.1 Authorization Code + PKCE configuration for an MCP server */
export interface MCPServerOAuthConfig {
    /** Authorization endpoint (e.g. https://auth.example.com/authorize) */
    authorizationUrl: string;
    /** Token endpoint (e.g. https://auth.example.com/token) */
    tokenUrl: string;
    /** Pre-registered public client id */
    clientId: string;
    /** Optional client secret for confidential clients (omit for public/PKCE-only) */
    clientSecret?: string;
    /** Space-delimited scopes requested */
    scopes?: string[];
    /** Optional audience claim */
    audience?: string;
}

/** MCP configuration */
export interface MCPSettings {
    servers: MCPServerConfig[];
}

export type LSPTransportType = 'stdio' | 'tcp';

interface BaseLSPServerConfig {
    /** Config name, used for CLI and log identification */
    name: string;
    /** File extensions this server is responsible for, e.g. .py */
    extensions: string[];
    /** languageId used by didOpen; inferred from extension if omitted */    languageId?: string;
    /** Whether it is enabled */
    enabled?: boolean;
    /** Timeout for a single request in milliseconds */
    timeoutMs?: number;
    /** Initialization options for 'initialize' request */
    initializationOptions?: Record<string, unknown>;
}

export interface LSPStdioServerConfig extends BaseLSPServerConfig {
    /** Transport method, defaults to stdio */
    transport?: 'stdio';
    /** Start command */
    command: string;
    /** Arguments passed to the command */
    args?: string[];
    /** Additional environment variables */
    env?: Record<string, string>;
    /** Process working directory */
    cwd?: string;
}

export interface LSPTcpServerConfig extends BaseLSPServerConfig {
    /** Connect to language server via TCP socket */
    transport: 'tcp';
    /** Target host */
    host: string;
    /** Target port */
    port: number;
    /** Optional: Start a local process first, then connect to TCP server */
    command?: string;
    /** Arguments passed to the command */
    args?: string[];
    /** Additional environment variables */
    env?: Record<string, string>;
    /** Process working directory */
    cwd?: string;
}

/** External LSP Server configuration */
export type LSPServerConfig = LSPStdioServerConfig | LSPTcpServerConfig;

/** LSP configuration */
export interface LSPSettings {
    servers: LSPServerConfig[];
}

/** Context paths configuration */
export type ContextPaths = string[];

export interface PluginPreferences {
    enabled?: string[];
    disabled?: string[];
    paths?: string[];
    allowIncompatible?: boolean;
}

/** XQoder global configuration */
export interface XQoderConfig {
    /** Current theme name */
    theme?: string;
    /** Server configuration (serve/web) */
    server?: ServerConfig;
    /** Share mode */
    share?: ShareMode;
    /** Auto-update */
    autoupdate?: AutoupdateMode;
    /** TUI keybinds (can also be in tui.json) */
    keybinds?: TuiKeybindsConfig;
    /** Default LLM configuration */
    llm: LLMProviderConfig;
    /** Provider map */
    providers?: ProviderSettingsMap;
    /** List of disabled providers */
    disabledProviders?: LLMProviderName[];
    /** List of enabled providers (enables all if empty) */
    enabledProviders?: LLMProviderName[];
    /** Default agent name */
    defaultAgent?: string;
    /** Small model configuration */
    smallModel?: LLMModelReference;
    /** Agent map */
    agents?: AgentSettingsMap;
    /** Global instructions */
    instructions?: string[];
    /** Custom commands */
    commands?: Record<string, CommandTemplateSettings>;
    /** Permission configuration */
    permissions?: PermissionSettings;
    /** Disable all configured hooks */
    disableAllHooks?: boolean;
    /** Default deployment target */
    defaultDeployTarget?: DeployTarget;
    /** Vercel related configuration */
    vercel?: VercelSettings;
    /** Agent sandbox permissions */
    sandbox?: SandboxSettings;
    /** Hook configuration grouped by event name */
    hooks?: HooksSettings;
    /** MCP server configuration */
    mcp?: MCPSettings;
    /** LSP server configuration */
    lsp?: LSPSettings;
    /** Project history */
    recentProjects?: string[];
    /** Debug mode */
    debug?: boolean;
    /** Formatter configuration */
    formatter?: FormatterConfig;
    /** Watcher configuration */
    watcher?: WatcherConfig;
    /** Compaction configuration */
    compaction?: CompactionConfig;
    /** Context paths */
    contextPaths?: string[];
    /** Shell configuration */
    shell?: ShellConfig;
    /** Plugin configuration */
    plugins?: PluginPreferences;
    /** Environment variables to apply at startup (merged into process.env by `enableConfigs`). */
    env?: Record<string, string>;
}
/** Formatter configuration */
export interface FormatterConfig {
    command: string;
    args?: string[];
    extensions?: string[];
}

/** Watcher configuration */
export interface WatcherConfig {
    ignore: string[];
}

/** Compaction configuration */
export interface CompactionConfig {
    auto?: boolean;
    prune?: boolean;
    reserved?: number;
}

/** Application Configuration */
export interface AppConfig {
    /** Formatter configuration */
    formatter?: FormatterConfig;
    /** Watcher configuration */
    watcher?: WatcherConfig;
    /** Compaction configuration */
    compaction?: CompactionConfig;
    /** Context paths */
    contextPaths?: ContextPaths;
    /** Shell configuration */
    shell?: ShellConfig;
    /** Plugin configuration */
    plugins?: PluginPreferences;
}

/** Shell configuration */
export interface ShellConfig {
    /** Shell executable path */
    path?: string;
    /** Shell arguments */
    args?: string[];
}
