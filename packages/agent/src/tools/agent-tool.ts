// ============================================================
// Agent Tool — 允许主 agent 委派任务给子 agent
// 参考 OpenCode: internal/llm/tools/agent/agent-tool.go
// ============================================================

import type { ToolDefinition, ToolResult, LLMProviderConfig, LLMMessage } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import { createLLMProvider } from '../agent.js';

const TASK_AGENT_SYSTEM_PROMPT = `You are a research/exploration sub-agent. You have access to read-only tools for exploring the codebase. Your job is to thoroughly investigate the user's question and return a comprehensive answer.

Be thorough and specific. Include file paths, line numbers, and code snippets where relevant.`;

const TASK_TOOLS = ['read_file', 'list_files', 'glob_files', 'grep_content', 'search_code', 'sourcegraph', 'lsp_workspace_symbols', 'lsp_file_diagnostics', 'lsp_definition', 'lsp_references', 'lsp_hover'];

export class DelegateTaskTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'delegate_task',
        description: 'Delegate a research or exploration task to a sub-agent. The sub-agent has read-only access to the codebase (file reading, searching, LSP queries) but cannot modify files. Use this for tasks like: finding all usages of a function, understanding a module\'s architecture, searching for patterns across the codebase, or investigating how a feature is implemented.',
        parameters: [
            {
                name: 'task',
                type: 'string',
                description: 'A clear, specific description of the research/exploration task to delegate. Be as specific as possible about what information you need.',
                required: true,
            },
        ],
    };

    constructor(
        private llmConfig: LLMProviderConfig,
        private parentToolRegistry?: { get(name: string): ITool | undefined },
    ) {}

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const task = args.task as string;
        const toolCallId = (args.toolCallId as string) ?? 'delegate';

        if (!task?.trim()) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'Task description is required',
            };
        }

        try {
            const provider = createLLMProvider(this.llmConfig);

            const messages: LLMMessage[] = [
                { role: 'system', content: TASK_AGENT_SYSTEM_PROMPT },
                { role: 'user', content: task },
            ];

            const availableTools: ToolDefinition[] = [];
            if (this.parentToolRegistry) {
                for (const toolName of TASK_TOOLS) {
                    const tool = this.parentToolRegistry.get(toolName);
                    if (tool) {
                        availableTools.push(tool.definition);
                    }
                }
            }

            let result = '';
            const MAX_ITERATIONS = 8;

            for (let i = 0; i < MAX_ITERATIONS; i++) {
                const response = await provider.complete({
                    messages,
                    tools: availableTools.length > 0 ? availableTools : undefined,
                    maxTokens: 4096,
                    temperature: 0.2,
                });

                const toolCalls = response.message.toolCalls;
                if (!toolCalls || toolCalls.length === 0) {
                    result = response.message.content;
                    break;
                }

                messages.push({
                    role: 'assistant',
                    content: response.message.content || '',
                    toolCalls,
                });

                for (const tc of toolCalls) {
                    const tool = this.parentToolRegistry?.get(tc.name);
                    if (!tool) {
                        messages.push({
                            role: 'tool',
                            content: `Error: tool "${tc.name}" not available to sub-agent`,
                            toolCallId: tc.id,
                        });
                        continue;
                    }

                    if (!TASK_TOOLS.includes(tc.name)) {
                        messages.push({
                            role: 'tool',
                            content: `Error: tool "${tc.name}" is not allowed for sub-agent (read-only access only)`,
                            toolCallId: tc.id,
                        });
                        continue;
                    }

                    let parsedArgs: Record<string, unknown> = {};
                    try {
                        parsedArgs = typeof tc.arguments === 'string'
                            ? JSON.parse(tc.arguments) as Record<string, unknown>
                            : tc.arguments as unknown as Record<string, unknown>;
                    } catch { /* use empty args */ }

                    const toolResult = await tool.execute(
                        { ...parsedArgs, toolCallId: tc.id },
                        context,
                    );

                    const output = toolResult.success
                        ? toolResult.output
                        : `Error: ${toolResult.error}`;

                    const truncated = output.length > 8000
                        ? output.slice(0, 8000) + '\n... [truncated]'
                        : output;

                    messages.push({
                        role: 'tool',
                        content: truncated,
                        toolCallId: tc.id,
                    });
                }

                if (i === MAX_ITERATIONS - 1) {
                    result = messages
                        .filter(m => m.role === 'assistant' && m.content)
                        .map(m => m.content)
                        .join('\n');
                }
            }

            return {
                toolCallId,
                success: true,
                output: result || '(sub-agent returned no output)',
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Sub-agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}
