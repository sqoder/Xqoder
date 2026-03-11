import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus.js';
import type { AppEvent } from '@xqoder/protocol';

describe('EventBus contract (core-runtime)', () => {
  it('on + emit invokes handler with event', async () => {
    const bus = new EventBus();
    const handler = vi.fn((_event: AppEvent) => {});
    bus.on('message.delta', handler);

    const event: AppEvent = {
      type: 'message.delta',
      sessionId: 's1',
      timestamp: 1,
      source: 'model',
      messageId: 'm1',
      role: 'assistant',
      text: 'hi',
    };
    await bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('wildcard handler receives all events', async () => {
    const bus = new EventBus();
    const wildcard = vi.fn((_event: AppEvent) => {});
    bus.on('*', wildcard);

    const event: AppEvent = {
      type: 'status.changed',
      sessionId: 's1',
      timestamp: 1,
      source: 'runtime',
      status: 'done',
    };
    await bus.emit(event);

    expect(wildcard).toHaveBeenCalledWith(event);
  });

  it('unsubscribe removes handler', async () => {
    const bus = new EventBus();
    const handler = vi.fn((_event: AppEvent) => {});
    const off = bus.on('error', handler);
    off();

    await bus.emit({
      type: 'error',
      sessionId: 's1',
      timestamp: 1,
      source: 'runtime',
      message: 'fail',
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
