import type { AppEvent } from '@xqoder/protocol';

export type EventHandler = (event: AppEvent) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<AppEvent['type'] | '*', Set<EventHandler>>();

  on(type: AppEvent['type'] | '*', handler: EventHandler): () => void {
    const bucket = this.handlers.get(type) ?? new Set<EventHandler>();
    bucket.add(handler);
    this.handlers.set(type, bucket);

    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  async emit(event: AppEvent): Promise<void> {
    const specific = this.handlers.get(event.type) ?? new Set<EventHandler>();
    const wildcard = this.handlers.get('*') ?? new Set<EventHandler>();

    for (const handler of [...specific, ...wildcard]) {
      await handler(event);
    }
  }
}
