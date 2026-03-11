// ============================================================
// OpenClaw 集成层 — 多渠道 AI 网关对接
// Xqoder 独有功能：接入 OpenClaw 的 Agent/Plugin/Memory 能力
// ============================================================

/**
 * OpenClaw 集成配置
 */
export interface OpenClawConfig {
    /** OpenClaw 服务地址 */
    endpoint: string;
    /** API Key */
    apiKey?: string;
    /** 启用的渠道 */
    channels?: OpenClawChannel[];
    /** 是否启用 Memory 系统 */
    enableMemory?: boolean;
    /** 是否启用 Plugin 系统 */
    enablePlugins?: boolean;
    /** 超时时间 (ms) */
    timeoutMs?: number;
}

/** 支持的渠道列表 */
export type OpenClawChannel =
    | 'telegram'
    | 'discord'
    | 'slack'
    | 'whatsapp'
    | 'wechat'
    | 'line'
    | 'web'
    | 'api';

/** OpenClaw 消息格式 */
export interface OpenClawMessage {
    id: string;
    channel: OpenClawChannel;
    userId: string;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

/** OpenClaw Agent 响应 */
export interface OpenClawResponse {
    id: string;
    content: string;
    channel: OpenClawChannel;
    agentId?: string;
    toolCalls?: OpenClawToolCall[];
    memoryUpdated?: boolean;
}

/** OpenClaw 工具调用 */
export interface OpenClawToolCall {
    name: string;
    args: Record<string, unknown>;
    result?: string;
}

/** 插件信息 */
export interface OpenClawPlugin {
    id: string;
    name: string;
    version: string;
    description: string;
    enabled: boolean;
}

/** Memory 条目 */
export interface OpenClawMemoryEntry {
    id: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: number;
    score?: number;
}

// ---- OpenClaw 客户端 ----

/**
 * OpenClawClient
 * 与 OpenClaw 服务通信的客户端
 */
export class OpenClawClient {
    private config: OpenClawConfig;
    private connected = false;

    constructor(config: OpenClawConfig) {
        this.config = {
            timeoutMs: 30_000,
            enableMemory: true,
            enablePlugins: true,
            ...config,
        };
    }

    // ---- 连接管理 ----

    /** 连接到 OpenClaw 服务 */
    async connect(): Promise<void> {
        try {
            const response = await this.request<{ status: string }>('/api/health');
            if (response.status === 'ok') {
                this.connected = true;
            }
        } catch (err) {
            throw new Error(`无法连接到 OpenClaw: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 断开连接 */
    async disconnect(): Promise<void> {
        this.connected = false;
    }

    /** 检查连接状态 */
    isConnected(): boolean {
        return this.connected;
    }

    // ---- Agent API ----

    /** 发送消息到 OpenClaw Agent */
    async sendMessage(
        message: string,
        options?: {
            channel?: OpenClawChannel;
            userId?: string;
            sessionId?: string;
            context?: Record<string, unknown>;
        },
    ): Promise<OpenClawResponse> {
        return this.request<OpenClawResponse>('/api/agent/chat', {
            method: 'POST',
            body: {
                message,
                channel: options?.channel ?? 'api',
                userId: options?.userId ?? 'xqoder-user',
                sessionId: options?.sessionId,
                context: options?.context,
            },
        });
    }

    /** 流式发送消息 */
    async *streamMessage(
        message: string,
        options?: {
            channel?: OpenClawChannel;
            userId?: string;
            sessionId?: string;
        },
    ): AsyncGenerator<string> {
        const response = await this.rawRequest('/api/agent/chat/stream', {
            method: 'POST',
            body: {
                message,
                channel: options?.channel ?? 'api',
                userId: options?.userId ?? 'xqoder-user',
                sessionId: options?.sessionId,
            },
        });

        if (!response.body) {
            throw new Error('No response body for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                yield decoder.decode(value, { stream: true });
            }
        } finally {
            reader.releaseLock();
        }
    }

    // ---- Plugin API ----

    /** 列出可用插件 */
    async listPlugins(): Promise<OpenClawPlugin[]> {
        if (!this.config.enablePlugins) return [];
        return this.request<OpenClawPlugin[]>('/api/plugins');
    }

    /** 启用/禁用插件 */
    async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
        await this.request('/api/plugins/' + pluginId, {
            method: 'PATCH',
            body: { enabled },
        });
    }

    /** 调用插件功能 */
    async invokePlugin(
        pluginId: string,
        action: string,
        params?: Record<string, unknown>,
    ): Promise<unknown> {
        return this.request(`/api/plugins/${pluginId}/invoke`, {
            method: 'POST',
            body: { action, params },
        });
    }

    // ---- Memory API ----

    /** 搜索 Memory */
    async searchMemory(query: string, limit: number = 5): Promise<OpenClawMemoryEntry[]> {
        if (!this.config.enableMemory) return [];
        return this.request<OpenClawMemoryEntry[]>('/api/memory/search', {
            method: 'POST',
            body: { query, limit },
        });
    }

    /** 添加 Memory */
    async addMemory(
        content: string,
        metadata?: Record<string, unknown>,
    ): Promise<OpenClawMemoryEntry> {
        return this.request<OpenClawMemoryEntry>('/api/memory', {
            method: 'POST',
            body: { content, metadata },
        });
    }

    /** 删除 Memory */
    async deleteMemory(memoryId: string): Promise<void> {
        await this.request(`/api/memory/${memoryId}`, { method: 'DELETE' });
    }

    // ---- Channel API ----

    /** 列出已连接的渠道 */
    async listChannels(): Promise<{ channel: OpenClawChannel; connected: boolean }[]> {
        return this.request<{ channel: OpenClawChannel; connected: boolean }[]>('/api/channels');
    }

    /** 通过指定渠道发送消息 */
    async sendToChannel(
        channel: OpenClawChannel,
        targetId: string,
        message: string,
    ): Promise<void> {
        await this.request(`/api/channels/${channel}/send`, {
            method: 'POST',
            body: { targetId, message },
        });
    }

    // ---- 内部方法 ----

    private async request<T>(
        path: string,
        options?: {
            method?: string;
            body?: unknown;
        },
    ): Promise<T> {
        const response = await this.rawRequest(path, options);

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`OpenClaw API error ${response.status}: ${text}`);
        }

        return response.json() as Promise<T>;
    }

    private async rawRequest(
        path: string,
        options?: {
            method?: string;
            body?: unknown;
        },
    ): Promise<Response> {
        const url = `${this.config.endpoint}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'xqoder/1.0',
        };

        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            this.config.timeoutMs ?? 30_000,
        );

        try {
            return await fetch(url, {
                method: options?.method ?? 'GET',
                headers,
                body: options?.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }
}

// ---- 工厂函数 ----

/**
 * 创建 OpenClaw 客户端
 */
export function createOpenClawClient(config: OpenClawConfig): OpenClawClient {
    return new OpenClawClient(config);
}

/**
 * 从环境变量创建 OpenClaw 客户端
 */
export function createOpenClawClientFromEnv(): OpenClawClient | null {
    const endpoint = process.env['OPENCLAW_ENDPOINT'];
    if (!endpoint) return null;

    return new OpenClawClient({
        endpoint,
        apiKey: process.env['OPENCLAW_API_KEY'],
        enableMemory: process.env['OPENCLAW_ENABLE_MEMORY'] !== 'false',
        enablePlugins: process.env['OPENCLAW_ENABLE_PLUGINS'] !== 'false',
    });
}
