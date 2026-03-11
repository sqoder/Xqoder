// ============================================================
// Sub-Agents — 专用子 Agent
// 参考 OpenCode: internal/llm/agent/agent.go
// ============================================================

import type { LLMProviderConfig, LLMMessage, StreamCallbacks } from '@xqoder/shared';
import { createLLMProvider } from './agent.js';
import type { ILLMProvider } from './llm/provider.js';

// ---- Agent 名称常量 ----

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
 * 当对话上下文过长时，自动压缩历史消息
 */
export class SummarizerAgent {
    private provider: ILLMProvider;

    constructor(config: LLMProviderConfig) {
        this.provider = createLLMProvider(config);
    }

    /**
     * 压缩对话历史
     * @param messages 需要压缩的消息列表
     * @returns 压缩后的摘要文本
     */
    async summarize(messages: LLMMessage[]): Promise<string> {
        // 构建压缩请求：将所有消息序列化为文本
        const conversationText = messages
            .filter(m => m.role !== 'system')
            .map(m => {
                const prefix = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
                const content = m.content.length > 2000
                    ? m.content.slice(0, 2000) + '... [截断]'
                    : m.content;
                return `[${prefix}]: ${content}`;
            })
            .join('\n\n');

        const response = await this.provider.complete({
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
 * 根据用户的第一条消息自动生成 session 标题
 */
export class TitleAgent {
    private provider: ILLMProvider;

    constructor(config: LLMProviderConfig) {
        this.provider = createLLMProvider(config);
    }

    /**
     * 生成 session 标题
     * @param userMessage 用户的第一条消息
     * @returns 生成的标题
     */
    async generateTitle(userMessage: string): Promise<string> {
        const response = await this.provider.complete({
            messages: [
                { role: 'system', content: TITLE_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            maxTokens: 64,
            temperature: 0.3,
        });

        // 清理输出
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
 * 将复杂任务分解为可执行的子任务
 */
export class TaskAgent {
    private provider: ILLMProvider;

    constructor(config: LLMProviderConfig) {
        this.provider = createLLMProvider(config);
    }

    /**
     * 分解任务
     * @param taskDescription 任务描述
     * @returns 子任务列表
     */
    async decompose(taskDescription: string): Promise<string[]> {
        const response = await this.provider.complete({
            messages: [
                { role: 'system', content: TASK_SYSTEM_PROMPT },
                { role: 'user', content: taskDescription },
            ],
            maxTokens: 1024,
            temperature: 0.3,
        });

        try {
            // 尝试从响应中提取 JSON 数组
            const content = response.message.content;
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as string[];
            }

            // 回退：按行分割
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

// ---- 工厂函数 ----

export interface SubAgents {
    summarizer: SummarizerAgent;
    title: TitleAgent;
    task: TaskAgent;
}

/**
 * 创建所有子 Agent
 * 子 Agent 可以使用较小/便宜的模型来节约成本
 */
export function createSubAgents(config: LLMProviderConfig): SubAgents {
    return {
        summarizer: new SummarizerAgent(config),
        title: new TitleAgent(config),
        task: new TaskAgent(config),
    };
}
