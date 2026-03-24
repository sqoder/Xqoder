import { describe, expect, it } from 'vitest';
import type { AppEvent } from '@xqoder/protocol';
import { createXQoderAgentProvider } from './agent-provider.js';

describe('XQoderAgentProvider', () => {
  it('translates agent callbacks into protocol events', async () => {
    const provider = createXQoderAgentProvider({
      llmConfig: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
      },
    }, {
      createAgent: () => ({
        async run(_prompt, callbacks) {
          callbacks?.onIteration?.(1);
          callbacks?.onToken?.('Hel');
          callbacks?.onToken?.('lo');
          callbacks?.onToolStart?.('read_file', { path: 'README.md' });
          callbacks?.onToolEnd?.('read_file', 'done', true);
          callbacks?.onComplete?.({ role: 'assistant', content: 'Hello' });
          return 'Hello';
        },
      }),
    });

    const events: AppEvent[] = [];
    for await (const event of provider.run({
      prompt: 'hello',
      messages: [],
    }, {
      sessionId: 'session-1',
      cwd: '/repo',
      permissionPolicy: {
        evaluate: async () => 'allow' as const,
      },
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'message.started',
      'message.completed',
      'status.changed',
      'status.changed',
      'message.started',
      'message.delta',
      'message.delta',
      'tool.called',
      'status.changed',
      'tool.output',
      'tool.completed',
      'message.completed',
      'status.changed',
      'message.completed',
      'status.changed',
    ]);
    const toolMessage = events.find((event) => event.type === 'message.completed' && event.message.role === 'tool');
    expect(toolMessage).toMatchObject({
      type: 'message.completed',
      message: {
        role: 'tool',
        content: 'done',
      },
    });
    expect(events.at(-2)).toMatchObject({
      type: 'message.completed',
      message: {
        role: 'assistant',
        content: 'Hello',
      },
    });
  });
});
