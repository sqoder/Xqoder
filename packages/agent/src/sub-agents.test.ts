import { describe, expect, it, vi } from 'vitest';
import type { ILLMProvider } from './llm/provider.js';
import { SummarizerAgent, buildCompactionSummaryPrompt } from './sub-agents.js';

describe('SummarizerAgent compaction prompt', () => {
    it('builds a layered compaction prompt with prior summary and preserved turns', () => {
        const prompt = buildCompactionSummaryPrompt({
            priorSummary: 'Previous daemon recovery work is complete.',
            compactedMessages: [
                { role: 'user', content: 'Please debug the renderer crash.' },
                { role: 'assistant', content: 'I traced it to viewport diffing.' },
            ],
            recentMessages: [
                { role: 'user', content: 'Keep the recent TUI scroll work intact.' },
                { role: 'assistant', content: 'I will preserve those latest turns verbatim.' },
            ],
        });

        expect(prompt).toContain('Existing historical summary:');
        expect(prompt).toContain('Older messages to compress:');
        expect(prompt).toContain('Recent messages kept verbatim in the session window:');
        expect(prompt).toContain('## Historical Summary');
        expect(prompt).toContain('[User]: Please debug the renderer crash.');
        expect(prompt).toContain('[Assistant]: I will preserve those latest turns verbatim.');
    });

    it('sends the layered prompt to the LLM when summarizing for compaction', async () => {
        const complete = vi.fn(async () => ({
            message: { role: 'assistant' as const, content: '## Historical Summary\n- done' },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'stop' as const,
        }));
        const provider = { complete } as unknown as ILLMProvider;
        const summarizer = new SummarizerAgent({
            provider: 'openai',
            model: 'gpt-4.1-mini',
            apiKey: 'test-key',
        }, provider);

        const summary = await summarizer.summarizeForCompaction({
            priorSummary: 'Earlier session recap.',
            compactedMessages: [
                { role: 'user', content: 'Investigate why fix flow stalled.' },
            ],
            recentMessages: [
                { role: 'assistant', content: 'Latest reconnect patch is already applied.' },
            ],
        });

        expect(summary).toContain('## Historical Summary');
        expect(complete).toHaveBeenCalledWith(expect.objectContaining({
            messages: expect.arrayContaining([
                expect.objectContaining({
                    role: 'user',
                    content: expect.stringContaining('Recent messages kept verbatim in the session window:'),
                }),
            ]),
        }));
    });
});
