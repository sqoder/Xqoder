// ============================================================
// EventBus — 类型安全的发布/订阅事件总线
// 参考 OpenCode: pubsub.Broker[T]
// ============================================================

type EventHandler<T> = (data: T) => void | Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventBus<EventMap extends Record<string, any> = Record<string, unknown>> {
    private listeners = new Map<keyof EventMap, Set<EventHandler<unknown>>>();

    on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const handlers = this.listeners.get(event)!;
        handlers.add(handler as EventHandler<unknown>);

        return () => {
            handlers.delete(handler as EventHandler<unknown>);
            if (handlers.size === 0) {
                this.listeners.delete(event);
            }
        };
    }

    once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
        const unsubscribe = this.on(event, (data) => {
            unsubscribe();
            return handler(data);
        });
        return unsubscribe;
    }

    emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler(data);
            } catch {
                // Swallow errors from handlers to prevent cascading failures
            }
        }
    }

    async emitAsync<K extends keyof EventMap>(event: K, data: EventMap[K]): Promise<void> {
        const handlers = this.listeners.get(event);
        if (!handlers) return;
        const promises: Promise<void>[] = [];
        for (const handler of handlers) {
            try {
                const result = handler(data);
                if (result instanceof Promise) {
                    promises.push(result);
                }
            } catch {
                // Swallow
            }
        }
        await Promise.allSettled(promises);
    }

    removeAllListeners<K extends keyof EventMap>(event?: K): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    listenerCount<K extends keyof EventMap>(event: K): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}

// ============================================================
// XQoder 全局事件类型定义
// ============================================================

export interface XQoderEvents {
    'session:created': { sessionId: string; title?: string };
    'session:updated': { sessionId: string };
    'session:deleted': { sessionId: string };
    'message:added': { sessionId: string; messageId: string; role: string };
    'tool:start': { sessionId?: string; toolName: string; args: Record<string, unknown> };
    'tool:end': { sessionId?: string; toolName: string; success: boolean };
    'file:changed': { filePath: string; toolName: string };
    'agent:start': { sessionId?: string; agent: string };
    'agent:complete': { sessionId?: string; agent: string };
    'agent:error': { sessionId?: string; error: string };
    'permission:requested': { toolName: string; description: string };
    'permission:granted': { toolName: string };
    'permission:denied': { toolName: string };
    'config:changed': { key: string };
}

export const globalEventBus = new EventBus<XQoderEvents>();
