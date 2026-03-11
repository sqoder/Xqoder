// ============================================================
// XQoder Shared Types
// ============================================================

// ---- 项目相关类型 ----

/** 项目类型枚举 */
export enum ProjectType {
    Node = 'node',
    Python = 'python',
    Docker = 'docker',
    Go = 'go',
    Static = 'static',
    Unknown = 'unknown',
}

/** 项目配置 */
export interface ProjectConfig {
    /** 项目根目录 */
    rootDir: string;
    /** 项目类型 */
    type: ProjectType;
    /** 项目名称 */
    name: string;
    /** 入口文件 */
    entryPoint?: string;
    /** 启动命令 */
    startCommand?: string;
    /** 开发端口 */
    port?: number;
    /** 环境变量 */
    env?: Record<string, string>;
}

/** Node 项目包管理器 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'unknown';

// ---- Runtime 相关类型 ----

/** Runtime 运行状态 */
export enum RuntimeStatus {
    Idle = 'idle',
    Starting = 'starting',
    Running = 'running',
    Error = 'error',
    Stopped = 'stopped',
}

/** 标准化运行报告 */
export interface RunReport {
    status: RuntimeStatus;
    /** 项目目录 */
    projectDir: string;
    /** 项目类型 */
    projectType: ProjectType;
    /** 检测到的框架 */
    framework?: string;
    /** 包管理器 */
    packageManager?: PackageManager;
    /** 实际执行命令 */
    command?: string;
    /** 实际端口 */
    port?: number;
    /** 运行地址（如 http://localhost:3000） */
    url?: string;
    /** 进程 PID */
    pid?: number;
    /** 错误信息 */
    errors: RuntimeError[];
    /** 日志输出 */
    logs: string[];
    /** 启动时间 */
    startedAt: Date;
    /** 完成时间 */
    completedAt?: Date;
}

/** Runtime 运行结果 */
export type RuntimeResult = RunReport;

/** 运行时错误 */
export interface RuntimeError {
    type: RuntimeErrorType;
    message: string;
    /** 错误源文件 */
    file?: string;
    /** 错误行号 */
    line?: number;
    /** 原始堆栈 */
    stack?: string;
    /** 建议修复方式 */
    suggestion?: string;
}

/** 运行时错误类型 */
export enum RuntimeErrorType {
    DependencyMissing = 'dependency_missing',
    CompileError = 'compile_error',
    RuntimeException = 'runtime_exception',
    PortConflict = 'port_conflict',
    PermissionDenied = 'permission_denied',
    ConfigError = 'config_error',
    Unknown = 'unknown',
}

// ---- Test 相关类型 ----

/** 测试状态 */
export enum TestStatus {
    Pending = 'pending',
    Running = 'running',
    Passed = 'passed',
    Failed = 'failed',
    Skipped = 'skipped',
}

/** 标准化测试失败信息 */
export interface TestFailure {
    message: string;
    testName?: string;
    file?: string;
}

/** 标准化测试报告 */
export interface TestReport {
    status: TestStatus;
    /** 项目目录 */
    projectDir: string;
    /** 包管理器 */
    packageManager?: PackageManager;
    /** 实际执行命令 */
    command?: string;
    /** 标准输出与标准错误合并后的结果 */
    output: string;
    /** 通过数量 */
    passed: number;
    /** 失败数量 */
    failed: number;
    /** 跳过数量 */
    skipped: number;
    /** 结构化失败摘要 */
    failures: TestFailure[];
    /** 开始时间 */
    startedAt: Date;
    /** 完成时间 */
    completedAt?: Date;
}

// ---- Deploy 相关类型 ----

/** 部署目标平台 */
export enum DeployTarget {
    Vercel = 'vercel',
    Cloudflare = 'cloudflare',
    AWS = 'aws',
    Custom = 'custom',
}

/** 部署状态 */
export enum DeployStatus {
    Pending = 'pending',
    Building = 'building',
    Deploying = 'deploying',
    Ready = 'ready',
    Failed = 'failed',
}

/** 标准化部署报告 */
export interface DeployReport {
    status: DeployStatus;
    /** 项目目录 */
    projectDir: string;
    /** 构建命令 */
    buildCommand?: string;
    /** 输出目录 */
    outputDir?: string;
    /** 部署后的 URL */
    url?: string;
    /** 部署目标 */
    target: DeployTarget;
    /** 部署 ID */
    deployId?: string;
    /** 错误信息 */
    error?: string;
    /** 部署开始时间 */
    startedAt: Date;
    /** 部署完成时间 */
    completedAt?: Date;
}

/** 部署结果 */
export type DeployResult = DeployReport;

/** 部署配置 */
export interface DeployConfig {
    target: DeployTarget;
    /** 项目目录 */
    projectDir: string;
    /** 项目名 */
    projectName?: string;
    /** Vercel 团队或个人 scope */
    scope?: string;
    /** 构建命令 */
    buildCommand?: string;
    /** 输出目录 */
    outputDir?: string;
    /** 环境变量 */
    env?: Record<string, string>;
    /** 平台特定配置 */
    platformConfig?: Record<string, unknown>;
}

// ---- Agent / LLM 相关类型 ----

/** LLM 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM 消息 */
export interface LLMMessage {
    role: MessageRole;
    content: string;
    /** 工具调用 ID（tool 角色时使用） */
    toolCallId?: string;
    /** 工具调用请求（assistant 角色时使用） */
    toolCalls?: ToolCall[];
    /** 推理/思考内容（extended thinking 模型产生） */
    thinking?: string;
    /** 二进制内容（图片等附件） */
    attachments?: MessageAttachment[];
    /** 结构化内容片段 (可选，与 content 并存以保持向后兼容) */
    parts?: ContentPart[];
}

/** 消息附件 */
export interface MessageAttachment {
    type: 'image' | 'file';
    mimeType: string;
    /** Base64 编码的数据 */
    data?: string;
    /** 文件路径（本地） */
    filePath?: string;
    /** URL（远程） */
    url?: string;
    fileName?: string;
}

// ---- 结构化消息内容类型（参考 OpenCode: internal/message/content.go）----

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';

export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; toolCall: ToolCall }
    | { type: 'tool_result'; toolCallId: string; output: string; success: boolean }
    | { type: 'image'; mimeType: string; data?: string; url?: string }
    | { type: 'finish'; reason: FinishReason };

/** 从 ContentPart 数组中提取纯文本 */
export function getTextContent(parts: ContentPart[]): string {
    return parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
}

/** 从 ContentPart 数组中提取思考内容 */
export function getReasoningContent(parts: ContentPart[]): string {
    return parts.filter(p => p.type === 'reasoning').map(p => (p as { text: string }).text).join('');
}

/** 从 ContentPart 数组中提取工具调用 */
export function getToolCallParts(parts: ContentPart[]): ToolCall[] {
    return parts
        .filter(p => p.type === 'tool_call')
        .map(p => (p as { type: 'tool_call'; toolCall: ToolCall }).toolCall);
}

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

/** LLM Provider 配置 */
export type LLMProviderName = 'openai' | 'anthropic' | 'dashscope' | 'gemini' | 'openai-compatible' | 'azure' | 'bedrock' | 'copilot' | 'vertexai' | 'groq' | 'openrouter' | 'local' | 'xai';

/** LLM Provider 配置 */
export interface LLMProviderConfig {
    provider: LLMProviderName;
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
}

/** LLM 流式回调 */
export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onThinkingToken?: (token: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
    onComplete?: (message: LLMMessage) => void;
    onError?: (error: Error) => void;
}

// ---- 工具定义类型 ----

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

// ---- Workflow 相关类型 ----

/** 工作流状态 */
export enum WorkflowStatus {
    Pending = 'pending',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Failed = 'failed',
}

/** 工作流步骤状态 */
export enum StepStatus {
    Pending = 'pending',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
    Skipped = 'skipped',
    RolledBack = 'rolled_back',
}

/** 工作流步骤结果 */
export interface StepResult {
    stepName: string;
    status: StepStatus;
    output?: string;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
}

/** 工作流执行上下文 */
export interface WorkflowContext {
    /** 项目配置 */
    projectConfig: ProjectConfig;
    /** 用户原始请求 */
    userRequest: string;
    /** 各步骤结果 */
    stepResults: StepResult[];
    /** 共享数据（步骤间传递） */
    data: Record<string, unknown>;
}

// ---- XQoder 全局配置 ----

/** Vercel 配置 */
export interface VercelSettings {
    /** 默认部署 scope */
    scope?: string;
}

/** Sandbox 权限模式 */
export type SandboxMode = 'project' | 'paths' | 'full-access';

/** Sandbox 配置 */
export interface SandboxSettings {
    /** 权限模式 */
    mode: SandboxMode;
    /** 额外允许访问的路径列表 */
    allowedPaths: string[];
}

/** Provider 持久化配置 */
export interface ProviderSettings {
    /** API Key */
    apiKey?: string;
    /** Provider 默认模型 */
    defaultModel?: string;
    /** Provider Base URL */
    baseUrl?: string;
    /** 默认 max tokens */
    maxTokens?: number;
    /** 默认 temperature */
    temperature?: number;
    /** 是否禁用 */
    disabled?: boolean;
}

/** Provider 配置集合 */
export type ProviderSettingsMap = Partial<Record<LLMProviderName, ProviderSettings>>;

/** Agent 模式 */
export type AgentMode = 'primary' | 'subagent';

/** Agent 权限模式 */
export type AgentPermissionMode = 'allow' | 'ask' | 'deny';

/** Agent 模型引用 */
export interface LLMModelReference {
    provider?: LLMProviderName;
    model: string;
}

/** Agent 配置 */
export interface AgentSettings {
    /** primary / subagent */
    mode?: AgentMode;
    /** 使用哪个 provider */
    provider?: LLMProviderName;
    /** 该 agent 默认模型 */
    model?: string;
    /** 覆盖 max tokens */
    maxTokens?: number;
    /** 覆盖 temperature */
    temperature?: number;
    /** 追加 system prompt */
    prompt?: string;
    /** 额外指令 */
    instructions?: string[];
    /** 限制可用工具 */
    tools?: string[];
    /** 该 agent 默认工作目录 */
    cwd?: string;
    /** 权限模式 */
    permissionMode?: AgentPermissionMode;
    /** 是否禁用 */
    disabled?: boolean;
    /** 是否优先使用 small model */
    useSmallModel?: boolean;
}

/** Agent 配置集合 */
export type AgentSettingsMap = Record<string, AgentSettings>;

/** 自定义命令配置 */
export interface CommandTemplateSettings {
    description?: string;
    prompt: string;
    agent?: string;
}

/** 权限配置 */
export interface PermissionSettings {
    /** 默认权限策略 */
    defaultMode?: AgentPermissionMode;
    /** 按工具覆盖 */
    tools?: Record<string, AgentPermissionMode>;
}

/** TUI 鼠标交互模式 */
export type TuiMouseMode = 'terminal' | 'app';

/** TUI 偏好设置 */
export interface TuiPreferences {
    /** terminal: 让终端原生负责选择/复制/滚动；app: TUI 捕获鼠标滚轮 */
    mouseMode?: TuiMouseMode;
    /** app 模式下鼠标滚轮的滚动步长 */
    scrollStep?: number;
}

/** 分享模式（OpenCode 风格） */
export type ShareMode = 'manual' | 'auto' | 'disabled';

/** 自动更新配置 */
export type AutoupdateMode = true | false | 'notify';

/** Server 配置（serve/web 用） */
export interface ServerConfig {
    port?: number;
    hostname?: string;
    mdns?: boolean;
    mdnsDomain?: string;
    cors?: string[];
}

/** TUI keybinds 配置（OpenCode 风格） */
export interface TuiKeybindsConfig {
    leader?: string;
    [key: string]: string | undefined;
}

/** tui.json 独立配置（OpenCode 风格） */
export interface TuiConfig {
    theme?: string;
    keybinds?: TuiKeybindsConfig;
    scroll_speed?: number;
    scroll_acceleration?: { enabled?: boolean };
    diff_style?: 'auto' | 'stacked';
}

/** MCP Server 配置 */
export interface MCPServerConfig {
    /** 配置名，用于 CLI 和工具前缀 */
    name: string;
    /** 启动命令 */
    command: string;
    /** 传给命令的参数 */
    args?: string[];
    /** 额外环境变量 */
    env?: Record<string, string>;
    /** 进程工作目录 */
    cwd?: string;
    /** 是否启用 */
    enabled?: boolean;
    /** 单次请求超时，单位毫秒 */
    timeoutMs?: number;
}

/** MCP 配置 */
export interface MCPSettings {
    servers: MCPServerConfig[];
}

export type LSPTransportType = 'stdio' | 'tcp';

interface BaseLSPServerConfig {
    /** 配置名，用于 CLI 和日志识别 */
    name: string;
    /** 该 server 负责的文件扩展名，例如 .py */
    extensions: string[];
    /** didOpen 使用的 languageId；缺省时会从扩展名推导 */
    languageId?: string;
    /** 是否启用 */
    enabled?: boolean;
    /** 单次请求超时，单位毫秒 */
    timeoutMs?: number;
    /** initialize 的初始化选项 */
    initializationOptions?: Record<string, unknown>;
}

export interface LSPStdioServerConfig extends BaseLSPServerConfig {
    /** 传输方式，缺省为 stdio */
    transport?: 'stdio';
    /** 启动命令 */
    command: string;
    /** 传给命令的参数 */
    args?: string[];
    /** 额外环境变量 */
    env?: Record<string, string>;
    /** 进程工作目录 */
    cwd?: string;
}

export interface LSPTcpServerConfig extends BaseLSPServerConfig {
    /** 通过 TCP socket 连接到 language server */
    transport: 'tcp';
    /** 目标主机 */
    host: string;
    /** 目标端口 */
    port: number;
    /** 可选：先启动一个本地进程，再连接到 TCP server */
    command?: string;
    /** 传给命令的参数 */
    args?: string[];
    /** 额外环境变量 */
    env?: Record<string, string>;
    /** 进程工作目录 */
    cwd?: string;
}

/** 外部 LSP Server 配置 */
export type LSPServerConfig = LSPStdioServerConfig | LSPTcpServerConfig;

/** LSP 配置 */
export interface LSPSettings {
    servers: LSPServerConfig[];
}

/** Formatter 配置（OpenCode parity） */
export interface FormatterConfig {
    /** 格式化命令 */
    command?: string;
    /** 命令参数 */
    args?: string[];
    /** 应用于哪些文件扩展名 */
    extensions?: string[];
}

/** Watcher 配置（OpenCode parity） */
export interface WatcherConfig {
    /** 忽略的文件/目录 glob 模式 */
    ignore?: string[];
}

/** Compaction 配置（OpenCode parity） */
export interface CompactionConfig {
    /** 是否启用自动压缩 */
    auto?: boolean;
    /** 是否裁剪压缩后的旧消息 */
    prune?: boolean;
    /** 保留最近 N 条消息 */
    reserved?: number;
}

/** Context paths 配置（OpenCode parity） */
export type ContextPaths = string[];

export interface PluginPreferences {
    enabled?: string[];
    disabled?: string[];
    paths?: string[];
    allowIncompatible?: boolean;
}

/** XQoder 全局配置 */
export interface XQoderConfig {
    /** 当前主题名称 */
    theme?: string;
    /** TUI 偏好 */
    tui?: TuiPreferences;
    /** Server 配置（serve/web） */
    server?: ServerConfig;
    /** 分享模式 */
    share?: ShareMode;
    /** 自动更新 */
    autoupdate?: AutoupdateMode;
    /** TUI keybinds（也可在 tui.json） */
    keybinds?: TuiKeybindsConfig;
    /** 默认 LLM 配置 */
    llm: LLMProviderConfig;
    /** Provider 图谱 */
    providers?: ProviderSettingsMap;
    /** 禁用的 provider 列表 */
    disabledProviders?: LLMProviderName[];
    /** 启用的 provider 列表（为空时启用所有） */
    enabledProviders?: LLMProviderName[];
    /** 默认 agent 名称 */
    defaultAgent?: string;
    /** 小模型配置 */
    smallModel?: LLMModelReference;
    /** Agent 图谱 */
    agents?: AgentSettingsMap;
    /** 全局指令 */
    instructions?: string[];
    /** 自定义命令 */
    commands?: Record<string, CommandTemplateSettings>;
    /** 权限配置 */
    permissions?: PermissionSettings;
    /** 默认部署目标 */
    defaultDeployTarget?: DeployTarget;
    /** Vercel 相关配置 */
    vercel?: VercelSettings;
    /** Agent sandbox 权限 */
    sandbox?: SandboxSettings;
    /** MCP 服务器配置 */
    mcp?: MCPSettings;
    /** LSP 服务器配置 */
    lsp?: LSPSettings;
    /** 项目历史 */
    recentProjects?: string[];
    /** 调试模式 */
    debug?: boolean;
    /** Formatter 配置 */
    formatter?: FormatterConfig;
    /** Watcher 配置 */
    watcher?: WatcherConfig;
    /** Compaction 配置 */
    compaction?: CompactionConfig;
    /** Context paths（类似 OpenCode 的 contextPaths） */
    contextPaths?: ContextPaths;
    /** Shell 配置 */
    shell?: ShellConfig;
    /** Plugin 配置 */
    plugins?: PluginPreferences;
}

/** Shell 配置 */
export interface ShellConfig {
    /** Shell 可执行文件路径 */
    path?: string;
    /** Shell 参数 */
    args?: string[];
}
