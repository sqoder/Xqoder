import type { ConversationEventEnvelope } from '@xqoder/protocol';

export type EventHandler = (event: ConversationEventEnvelope) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<ConversationEventEnvelope['type'] | '*', Set<EventHandler>>();

  on(type: ConversationEventEnvelope['type'] | '*', handler: EventHandler): () => void {
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

  async emit(event: ConversationEventEnvelope): Promise<void> {
    const specific = this.handlers.get(event.type) ?? new Set<EventHandler>();
    const wildcard = this.handlers.get('*') ?? new Set<EventHandler>();

    for (const handler of [...specific, ...wildcard]) {
      await handler(event);
    }
  }
}
