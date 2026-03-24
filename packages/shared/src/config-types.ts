import type { DeployTarget } from './deploy-types.js';
import type { LLMProviderConfig, LLMProviderName } from './llm-types.js';

// ---- 配置领域类型 ----

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
    /** 惯性滚动停止阈值（绝对速度低于该值时停止） */
    inertiaDecayThreshold?: number;
    /** 惯性滚动单帧最大步长（防止速度过高导致跳动） */
    inertiaMaxStep?: number;
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
    /** 传输方式，默认 stdio */
    transport?: 'stdio' | 'http' | 'sse';
    /** stdio 模式下的启动命令 */
    command?: string;
    /** 传给命令的参数 */
    args?: string[];
    /** 额外环境变量 */
    env?: Record<string, string>;
    /** 进程工作目录 */
    cwd?: string;
    /** http/sse 模式下的目标 URL */
    url?: string;
    /** http/sse 模式下的请求头 */
    headers?: Record<string, string>;
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

/** Shell 配置 */
export interface ShellConfig {
    /** Shell 可执行文件路径 */
    path?: string;
    /** Shell 参数 */
    args?: string[];
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
