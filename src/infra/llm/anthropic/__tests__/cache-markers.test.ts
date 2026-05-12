import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import { AnthropicProvider } from '../index.js';

type CreateCall = { params: CreateParams; response: unknown };

interface CreateParams {
  system?: unknown;
  messages: Array<{ role: string; content: unknown }>;
  model: string;
  max_tokens?: number;
  temperature?: number;
  tools?: unknown;
}

function collectCacheControl(request: CreateParams): unknown[] {
  const markers: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const entries = Object.entries(node as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (key === 'cache_control' && value) markers.push(value);
      else walk(value);
    }
  };
  walk(request.system);
  walk(request.messages);
  return markers;
}

function createConfig() {
  return {
    provider: 'anthropic' as const,
    model: 'claude-3-5-sonnet-20241022',
    apiKey: 'test-key',
  };
}

function stubClient(
  provider: AnthropicProvider,
  response: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
): { calls: CreateCall[] } {
  const calls: CreateCall[] = [];
  const fake = {
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: response,
  };
  (provider as unknown as {
    client: { messages: { create: (p: CreateParams) => Promise<unknown> } };
  }).client = {
    messages: {
      create: async (params: CreateParams) => {
        calls.push({ params, response: fake });
        return fake;
      },
    },
  };
  return { calls };
}

function buildMessages(text: string): LLMMessage[] {
  return [
    { role: 'system', content: 'stable system prompt' },
    { role: 'user', content: text },
  ];
}

describe('AnthropicProvider · prompt cache markers', () => {
  const originalDisable = process.env.XQODER_DISABLE_PROMPT_CACHE;

  afterEach(() => {
    if (originalDisable === undefined) {
      delete process.env.XQODER_DISABLE_PROMPT_CACHE;
    } else {
      process.env.XQODER_DISABLE_PROMPT_CACHE = originalDisable;
    }
  });

  it('system payload carries cache_control on its last text block', async () => {
    const provider = new AnthropicProvider(createConfig());
    const { calls } = stubClient(provider, { input_tokens: 10, output_tokens: 3 });

    await provider.complete({ messages: buildMessages('hello') });

    expect(calls.length).toBe(1);
    const system = calls[0].params.system;
    expect(Array.isArray(system)).toBe(true);
    const blocks = system as Array<Record<string, unknown>>;
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe('text');
    expect(last.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('last user message carries cache_control on its final content block', async () => {
    const provider = new AnthropicProvider(createConfig());
    const { calls } = stubClient(provider, { input_tokens: 12, output_tokens: 4 });

    await provider.complete({ messages: buildMessages('hi there') });

    const messages = calls[0].params.messages;
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('user');
    const content = lastMessage.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    const lastBlock = content[content.length - 1];
    expect(lastBlock.type).toBe('text');
    expect(lastBlock.text).toBe('hi there');
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('parses cache usage and folds cache tokens into promptTokens for cost math', async () => {
    const provider = new AnthropicProvider(createConfig());
    stubClient(provider, {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 50,
    });

    const result = await provider.complete({ messages: buildMessages('hi') });

    expect(result.usage.cacheReadTokens).toBe(500);
    expect(result.usage.cacheCreationTokens).toBe(50);
    // API semantics: input_tokens excludes cache read/creation. Fold them so
    // calculateCost's regularInput = promptTokens - cacheRead stays non-negative
    // and total tokens reflect what the API actually billed.
    expect(result.usage.promptTokens).toBe(100 + 500 + 50);
    expect(result.usage.completionTokens).toBe(20);
    expect(result.usage.totalTokens).toBe(100 + 500 + 50 + 20);
  });

  it('tolerates provider responses without cache fields (non-cache models)', async () => {
    const provider = new AnthropicProvider(createConfig());
    stubClient(provider, { input_tokens: 40, output_tokens: 10 });

    const result = await provider.complete({ messages: buildMessages('hi') });

    expect(result.usage.cacheReadTokens).toBe(0);
    expect(result.usage.cacheCreationTokens).toBe(0);
    expect(result.usage.promptTokens).toBe(40);
  });

  it('emits at most two cache_control markers per request', async () => {
    const provider = new AnthropicProvider(createConfig());
    const { calls } = stubClient(provider, { input_tokens: 5, output_tokens: 2 });

    await provider.complete({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'two' },
      ],
    });

    expect(collectCacheControl(calls[0].params).length).toBeLessThanOrEqual(2);
  });

  it('omits cache_control on system when there is no system message (still allowed on tail)', async () => {
    const provider = new AnthropicProvider(createConfig());
    const { calls } = stubClient(provider, { input_tokens: 5, output_tokens: 2 });

    await provider.complete({ messages: [{ role: 'user', content: 'standalone' }] });

    // No system message → provider must not fabricate a system array.
    expect(calls[0].params.system).toBeUndefined();
    const markers = collectCacheControl(calls[0].params);
    // Tail marker still permitted.
    expect(markers.length).toBeLessThanOrEqual(1);
  });

  describe('with XQODER_DISABLE_PROMPT_CACHE=1 (kill switch)', () => {
    beforeEach(() => {
      process.env.XQODER_DISABLE_PROMPT_CACHE = '1';
    });

    it('passes system as bare string and emits no cache_control markers', async () => {
      const provider = new AnthropicProvider(createConfig());
      const { calls } = stubClient(provider, {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      });

      await provider.complete({ messages: buildMessages('hi') });

      expect(typeof calls[0].params.system).toBe('string');
      expect(calls[0].params.system).toBe('stable system prompt');
      expect(collectCacheControl(calls[0].params)).toEqual([]);
    });

    it('still parses cache usage when the API reports it (for observability)', async () => {
      const provider = new AnthropicProvider(createConfig());
      stubClient(provider, {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 0,
      });

      const result = await provider.complete({ messages: buildMessages('hi') });
      expect(result.usage.cacheReadTokens).toBe(200);
    });
  });
});
