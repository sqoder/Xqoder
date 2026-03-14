import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSearchTool } from './fetch-tool.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('WebSearchTool', () => {
    it('returns parsed duckduckgo html results', async () => {
        const html = `
        <html><body>
          <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpost">Example Post</a>
          <div class="result__snippet">A short summary.</div>
          <a class="result__a" href="https://example.org">Second Result</a>
          <div class="result__snippet">Another summary.</div>
        </body></html>`;

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => html,
        }));

        const tool = new WebSearchTool();
        const result = await tool.execute({ query: 'xqoder parity', limit: 2, toolCallId: 'w1' }, {} as never);

        expect(result.success).toBe(true);
        expect(result.output).toContain('Example Post');
        expect(result.output).toContain('https://example.com/post');
        expect(result.output).toContain('Second Result');
        expect(result.metadata).toMatchObject({
            query: 'xqoder parity',
            resultCount: 2,
        });
    });

    it('validates missing query', async () => {
        const tool = new WebSearchTool();
        const result = await tool.execute({ query: '', toolCallId: 'w2' }, {} as never);
        expect(result.success).toBe(false);
        expect(result.error).toContain('query 参数不能为空');
    });
});
