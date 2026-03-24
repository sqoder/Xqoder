import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '@xqoder/shared';
import { AnthropicProvider } from './providers/index.js';
import { OpenAIProvider } from './providers/index.js';

const messageWithAttachments: LLMMessage = {
    role: 'user',
    content: 'describe these inputs',
    attachments: [
        {
            kind: 'image',
            type: 'image',
            mimeType: 'image/png',
            data: 'aGVsbG8=',
            filePath: '/tmp/demo.png',
            fileName: 'demo.png',
        },
        {
            kind: 'file',
            type: 'file',
            mimeType: 'application/octet-stream',
            filePath: '/workspace/src/app.ts',
            fileName: 'app.ts',
        },
    ],
};

describe('LLM provider attachment formatting', () => {
    it('formats mixed attachments for OpenAI-compatible providers', () => {
        const provider = new OpenAIProvider({
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'test-key',
        });

        const formatted = (provider as unknown as {
            formatMessages: (messages: LLMMessage[]) => Array<{ role: string; content: unknown }>;
        }).formatMessages([messageWithAttachments]);

        expect(formatted).toHaveLength(1);
        expect(formatted[0]?.role).toBe('user');
        expect(formatted[0]?.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('[AttachedFiles]'),
            },
            {
                type: 'image_url',
                image_url: {
                    url: 'data:image/png;base64,aGVsbG8=',
                },
            },
        ]);
    });

    it('formats mixed attachments for Anthropic providers', () => {
        const provider = new AnthropicProvider({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-latest',
            apiKey: 'test-key',
        });

        const formatted = (provider as unknown as {
            formatMessages: (messages: LLMMessage[]) => Array<{ role: string; content: unknown[] }>;
        }).formatMessages([messageWithAttachments]);

        expect(formatted).toHaveLength(1);
        expect(formatted[0]?.role).toBe('user');
        expect(formatted[0]?.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('[AttachedFiles]'),
            },
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'aGVsbG8=',
                },
            },
        ]);
    });
});
