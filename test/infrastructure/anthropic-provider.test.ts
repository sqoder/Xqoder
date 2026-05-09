import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import { AnthropicProvider } from '../../src/infra/llm/anthropic/index.js';

function createConfig() {
    return {
        provider: 'anthropic' as const,
        model: 'claude-test',
        apiKey: 'test-key',
    };
}

describe('AnthropicProvider', () => {
    it('bridges tool result attachments into Anthropic tool_result content blocks', () => {
        const provider = new AnthropicProvider(createConfig());
        const formatMessages = (provider as unknown as {
            formatMessages(messages: LLMMessage[]): Array<Record<string, unknown>>;
        }).formatMessages.bind(provider);

        const messages = formatMessages([{
            role: 'tool',
            toolCallId: 'tool-1',
            content: 'PDF pages rendered',
            attachments: [
                { type: 'image', mimeType: 'image/jpeg', data: 'cGFnZQ==', fileName: 'page-1.jpg' },
                { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=', fileName: 'report.pdf' },
            ],
        }]);

        expect(messages).toEqual([{
            role: 'user',
            content: [{
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: [
                    {
                        type: 'text',
                        text: 'PDF pages rendered',
                    },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: 'cGFnZQ==',
                        },
                    },
                    {
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: 'JVBERi0=',
                        },
                        title: 'report.pdf',
                    },
                ],
            }],
        }]);
    });
});
