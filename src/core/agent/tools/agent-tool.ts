// ============================================================
// Agent Tool — Allows the primary agent to delegate tasks to sub-agents
// Reference: internal/llm/tools/agent/agent-tool.go
// ============================================================

import type { ToolDefinition, ToolResult, LLMProviderConfig, LLMMessage } from '@xqoder/shared';
import type { ILLMProvider } from '../../../shared/llm-api/base.js';
import type { ITool, ToolContext } from './tool.js';
import { createLLMProvider } from '@xqoder/agent';
import { getBuiltInAgentDefinition } from '../agents.js';
import { getMarkdownAgentDefinition } from '../markdown-agents.js';
import { isToolVisibleForExecutionCapability } from '../../../domain/permissions/index.js';

const READONLY_DELEGATE_TOOLS = ['read_file', 'read_any_file', 'list_files', 'glob_files', 'grep_content', 'search_code', 'sourcegraph', 'lsp_workspace_symbols', 'lsp_file_diagnostics', 'lsp_definition', 'lsp_references', 'lsp_hover', 'todoread', 'skill'];
const WRITE_OR_SIDE_EFFECT_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch', 'restore_rollback_point', 'run_command', 'run_shell', 'install_package', 'todowrite']);
type DelegateProviderFactory = (config: LLMProviderConfig) => Promise<ILLMProvider> | ILLMProvider;
interface DelegateToolRegistry {
    get(name: string): ITool | undefined;
    execute(
        name: string,
        args: Record<string, unknown>,
        context: ToolContext,
        toolCallId: string,
    ): Promise<ToolResult>;
}

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
            {
                name: 'agent',
                type: 'string',
                description: 'Optional subagent name. Defaults to explore; built-in and .claude/agents markdown subagents are supported.',
                required: false,
            },
            {
                name: 'mode',
                type: 'string',
                description: 'Optional routing hint: explore, plan, or custom.',
                required: false,
            },
        ],
    };

    constructor(
        private llmConfig: LLMProviderConfig,
        private parentToolRegistry?: DelegateToolRegistry,
        private providerFactory: DelegateProviderFactory = createLLMProvider,
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
            const delegateConfig = resolveDelegateConfig(args, context.cwd);
            const provider = await this.providerFactory(this.llmConfig);

            const messages: LLMMessage[] = [
                { role: 'system', content: delegateConfig.systemPrompt },
                { role: 'user', content: buildDelegatePrompt(task, delegateConfig.agentName) },
            ];

            const allowedToolNames = resolveDelegateToolNames(delegateConfig.requestedTools);
            const availableTools = this.getAvailableToolDefinitions(allowedToolNames);

            let result = '';
            const MAX_ITERATIONS = 8;
            let toolCallsExecuted = 0;
            const evidence: string[] = [];

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
                    const registry = this.parentToolRegistry;
                    const tool = registry?.get(tc.name);
                    if (!registry || !tool) {
                        messages.push({
                            role: 'tool',
                            content: `Error: tool "${tc.name}" not available to sub-agent`,
                            toolCallId: tc.id,
                        });
                        continue;
                    }

                    if (!this.isDelegateToolAllowed(tc.name, tool) || !allowedToolNames.includes(tc.name)) {
                        messages.push({
                            role: 'tool',
                            content: `Error: tool "${tc.name}" is not allowed for sub-agent "${delegateConfig.agentName}"`,
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

                    const toolResult = await registry.execute(
                        tc.name,
                        parsedArgs,
                        context,
                        tc.id,
                    );

                    const output = toolResult.success
                        ? toolResult.output
                        : `Error: ${toolResult.error}`;

                    const truncated = output.length > 8000
                        ? output.slice(0, 8000) + '\n... [truncated]'
                        : output;
                    toolCallsExecuted += 1;
                    evidence.push(`${tc.name}: ${truncated.slice(0, 500)}`);

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
                output: [
                    `agent: ${delegateConfig.agentName}`,
                    `iterations: ${Math.min(messages.filter((message) => message.role === 'assistant').length, MAX_ITERATIONS)}`,
                    `toolCalls: ${toolCallsExecuted}`,
                    'final:',
                    result || '(sub-agent returned no output)',
                    ...(evidence.length > 0
                        ? ['evidence:', ...evidence.slice(-5)]
                        : []),
                ].join('\n'),
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

    private getAvailableToolDefinitions(allowedToolNames: string[]): ToolDefinition[] {
        const availableTools: ToolDefinition[] = [];
        if (!this.parentToolRegistry) {
            return availableTools;
        }

        for (const toolName of allowedToolNames) {
            const tool = this.parentToolRegistry.get(toolName);
            if (tool && this.isDelegateToolAllowed(toolName, tool)) {
                availableTools.push(tool.definition);
            }
        }

        return availableTools;
    }

    private isDelegateToolAllowed(toolName: string, tool: ITool): boolean {
        return isDelegateToolAllowed(toolName, tool);
    }
}

interface DelegateConfig {
    agentName: string;
    systemPrompt: string;
    requestedTools?: string[];
}

function resolveDelegateConfig(args: Record<string, unknown>, cwd: string): DelegateConfig {
    const mode = String(args.mode ?? '').trim().toLowerCase();
    const rawAgent = String(args.agent ?? '').trim();
    const agentName = rawAgent || (mode === 'plan' ? 'plan' : 'explore');
    const markdownAgent = getMarkdownAgentDefinition(agentName, cwd);
    const builtInAgent = getBuiltInAgentDefinition(agentName);

    return {
        agentName,
        systemPrompt: markdownAgent?.prompt
            ?? builtInAgent?.systemPrompt
            ?? `You are a ${agentName} sub-agent. Complete the delegated task using only the provided safe tools and return a concise, evidence-backed answer.`,
        requestedTools: markdownAgent?.tools,
    };
}

function buildDelegatePrompt(task: string, agentName: string): string {
    return `Subagent: ${agentName}

Task:
${task}

Return only the delegated result. Include concrete file paths, symbols, or reasoning steps when they are necessary for the primary agent to act.`;
}

function resolveDelegateToolNames(requestedTools: string[] | undefined): string[] {
    const base = requestedTools && requestedTools.length > 0
        ? requestedTools
        : READONLY_DELEGATE_TOOLS;
    return Array.from(new Set(base.filter((toolName) => !WRITE_OR_SIDE_EFFECT_TOOLS.has(toolName))));
}

function isDelegateToolAllowed(toolName: string, tool: ITool): boolean {
    return isToolVisibleForExecutionCapability(
        toolName,
        'read_only',
        tool.getSecurityPolicyContext?.(),
    );
}
