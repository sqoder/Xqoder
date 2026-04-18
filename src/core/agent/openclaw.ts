// ============================================================
// OpenClaw Integration Layer — Multi-channel AI Gateway
// Xqoder Exclusive: Access OpenClaw Agent/Plugin/Memory capabilities
// ============================================================

/**
 * OpenClaw Integration Configuration
 */
export interface OpenClawConfig {
    /** OpenClaw Service Endpoint */
    endpoint: string;
    /** API Key */
    apiKey?: string;
    /** Enabled Channels */
    channels?: OpenClawChannel[];
    /** Whether to enable Memory system */
    enableMemory?: boolean;
    /** Whether to enable Plugin system */
    enablePlugins?: boolean;
    /** Timeout (ms) */
    timeoutMs?: number;
}

/** Supported Channels */
export type OpenClawChannel =
    | 'telegram'
    | 'discord'
    | 'slack'
    | 'whatsapp'
    | 'wechat'
    | 'line'
    | 'web'
    | 'api';

/** OpenClaw Message Format */
export interface OpenClawMessage {
    id: string;
    channel: OpenClawChannel;
    userId: string;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

/** OpenClaw Agent Response */
export interface OpenClawResponse {
    id: string;
    content: string;
    channel: OpenClawChannel;
    agentId?: string;
    toolCalls?: OpenClawToolCall[];
    memoryUpdated?: boolean;
}

/** OpenClaw Tool Call */
export interface OpenClawToolCall {
    name: string;
    args: Record<string, unknown>;
    result?: string;
}

/** Plugin Information */
export interface OpenClawPlugin {
    id: string;
    name: string;
    version: string;
    description: string;
    enabled: boolean;
}

/** Memory Entry */
export interface OpenClawMemoryEntry {
    id: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: number;
    score?: number;
}

// ---- OpenClaw Client ----

/**
 * OpenClawClient
 * Client for communicating with OpenClaw service
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

    // ---- Connection Management ----

    /** Connect to OpenClaw service */
    async connect(): Promise<void> {
        try {
            const response = await this.request<{ status: string }>('/api/health');
            if (response.status === 'ok') {
                this.connected = true;
            }
        } catch (err) {
            throw new Error(`Unable to connect to OpenClaw: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Disconnect */
    async disconnect(): Promise<void> {
        this.connected = false;
    }

    /** Check connection status */
    isConnected(): boolean {
        return this.connected;
    }

    // ---- Agent API ----

    /** Send message to OpenClaw Agent */
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

    /** Stream message */
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

    /** List available plugins */
    async listPlugins(): Promise<OpenClawPlugin[]> {
        if (!this.config.enablePlugins) return [];
        return this.request<OpenClawPlugin[]>('/api/plugins');
    }

    /** Enable/Disable plugin */
    async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
        await this.request('/api/plugins/' + pluginId, {
            method: 'PATCH',
            body: { enabled },
        });
    }

    /** Invoke plugin action */
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

    /** Search Memory */
    async searchMemory(query: string, limit: number = 5): Promise<OpenClawMemoryEntry[]> {
        if (!this.config.enableMemory) return [];
        return this.request<OpenClawMemoryEntry[]>('/api/memory/search', {
            method: 'POST',
            body: { query, limit },
        });
    }

    /** Add Memory */
    async addMemory(
        content: string,
        metadata?: Record<string, unknown>,
    ): Promise<OpenClawMemoryEntry> {
        return this.request<OpenClawMemoryEntry>('/api/memory', {
            method: 'POST',
            body: { content, metadata },
        });
    }

    /** Delete Memory */
    async deleteMemory(memoryId: string): Promise<void> {
        await this.request(`/api/memory/${memoryId}`, { method: 'DELETE' });
    }

    // ---- Channel API ----

    /** List connected channels */
    async listChannels(): Promise<{ channel: OpenClawChannel; connected: boolean }[]> {
        return this.request<{ channel: OpenClawChannel; connected: boolean }[]>('/api/channels');
    }

    /** Send message via specified channel */
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

    // ---- Internal Methods ----

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

// ---- Factory Functions ----

/**
 * Create OpenClaw Client
 */
export function createOpenClawClient(config: OpenClawConfig): OpenClawClient {
    return new OpenClawClient(config);
}

/**
 * Create OpenClaw Client from environment variables
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
