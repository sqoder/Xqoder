// ============================================================
// Sub-Agents — Specialized sub-agents
// Reference OpenCode: internal/llm/agent/agent.go
// ============================================================

import type { LLMProviderConfig, LLMMessage } from '@xqoder/shared';
import { createLLMProvider } from '@xqoder/agent';
import type { ILLMProvider } from './llm/provider.js';

// ---- Agent name constants ----

export type AgentName = 'coder' | 'summarizer' | 'title' | 'task';

// ---- Summarizer Agent ----

const SUMMARIZER_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to condense a long conversation history into a compact summary that preserves all important context.

Rules:
- Keep all file paths, function names, and variable names mentioned
- Keep all decisions, changes made, and error resolutions
- Keep the user's original requests and key preferences
- Remove redundant back-and-forth, repeated information, and verbose tool outputs
- Output a structured summary in Markdown format
- Be concise but complete — nothing actionable should be lost`;

/**
 * SummarizerAgent
 * Automatically compresses history when context length exceeds limit
 */
export class SummarizerAgent {
    private provider: ILLMProvider | null = null;

    constructor(private readonly config: LLMProviderConfig) {}

    private async getProvider(): Promise<ILLMProvider> {
        if (!this.provider) {
            this.provider = await createLLMProvider(this.config);
        }
        return this.provider;
    }

    /**
     * Compress conversation history
     * @param messages List of messages to compress
     * @returns Compressed summary text
     */
    async summarize(messages: LLMMessage[]): Promise<string> {
        const provider = await this.getProvider();
        // Build compression request: serialize all messages to text
        const conversationText = messages
            .filter(m => m.role !== 'system')
            .map(m => {
                const prefix = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
                const content = m.content.length > 2000
                    ? m.content.slice(0, 2000) + '... [truncated]'
                    : m.content;
                return `[${prefix}]: ${content}`;
            })
            .join('\n\n');

        const response = await provider.complete({
            messages: [
                { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
                { role: 'user', content: `Please summarize the following conversation:\n\n${conversationText}` },
            ],
            maxTokens: 2048,
            temperature: 0.2,
        });

        return response.message.content;
    }
}

// ---- Title Agent ----

const TITLE_SYSTEM_PROMPT = `Generate a short, descriptive title for a conversation based on the user's first message.

Rules:
- Maximum 50 characters
- No quotes or special formatting
- Be specific and descriptive
- Use the language of the user's message
- Output ONLY the title, nothing else`;

/**
 * TitleAgent
 * Automatically generate session title based on the user's first message
 */
export class TitleAgent {
    private provider: ILLMProvider | null = null;

    constructor(private readonly config: LLMProviderConfig) {}

    private async getProvider(): Promise<ILLMProvider> {
        if (!this.provider) {
            this.provider = await createLLMProvider(this.config);
        }
        return this.provider;
    }

    /**
     * Generate session title
     * @param userMessage User's first message
     * @returns Generated title
     */
    async generateTitle(userMessage: string): Promise<string> {
        const provider = await this.getProvider();
        const response = await provider.complete({
            messages: [
                { role: 'system', content: TITLE_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            maxTokens: 64,
            temperature: 0.3,
        });

        // Clean output
        return response.message.content
            .replace(/^["']|["']$/g, '')
            .replace(/\n/g, ' ')
            .trim()
            .slice(0, 50);
    }
}

// ---- Task Agent ----

const TASK_SYSTEM_PROMPT = `You are a task planning agent. Given a complex coding task, break it down into smaller, actionable sub-tasks.

Rules:
- Each sub-task should be independently executable
- Order sub-tasks by dependency
- Each sub-task should have a clear 1-line description
- Output as a JSON array of strings
- Maximum 10 sub-tasks
- Be practical and specific`;

/**
 * TaskAgent
 * Decomposes complex tasks into actionable sub-tasks
 */
export class TaskAgent {
    private provider: ILLMProvider | null = null;

    constructor(private readonly config: LLMProviderConfig) {}

    private async getProvider(): Promise<ILLMProvider> {
        if (!this.provider) {
            this.provider = await createLLMProvider(this.config);
        }
        return this.provider;
    }

    /**
     * Decompose task
     * @param taskDescription Task description
     * @returns List of sub-tasks
     */
    async decompose(taskDescription: string): Promise<string[]> {
        const provider = await this.getProvider();
        const response = await provider.complete({
            messages: [
                { role: 'system', content: TASK_SYSTEM_PROMPT },
                { role: 'user', content: taskDescription },
            ],
            maxTokens: 1024,
            temperature: 0.3,
        });

        try {
            // Try to extract JSON array from response
            const content = response.message.content;
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as string[];
            }

            // Fallback: split by line
            return content
                .split('\n')
                .map(line => line.replace(/^[\d]+\.\s*/, '').trim())
                .filter(Boolean)
                .slice(0, 10);
        } catch {
            return [taskDescription];
        }
    }
}

// ---- Factory functions ----

export interface SubAgents {
    summarizer: SummarizerAgent;
    title: TitleAgent;
    task: TaskAgent;
}

/**
 * Create all sub-agents
 * Sub-agents can use smaller/cheaper models to save costs
 */
export function createSubAgents(config: LLMProviderConfig): SubAgents {
    return {
        summarizer: new SummarizerAgent(config),
        title: new TitleAgent(config),
        task: new TaskAgent(config),
    };
}
