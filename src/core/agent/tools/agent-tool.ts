// ============================================================
// Agent Tool — P16d rewrite: uses forkSubagentsBatch + renderAgentMemorySnapshot.
// ============================================================

import type { ToolDefinition, ToolResult, LLMProviderConfig, LLMMessage } from '@xqoder/shared';
import type { ILLMProvider } from '../../../shared/llm-api/base.js';
import type { ITool, ToolContext } from './tool.js';
import { createLLMProvider } from '@xqoder/agent';
import {
    buildSubagentStopPayload,
    dispatchLifecycleHookFireAndForget,
} from '../lifecycle-hooks.js';
import { getMarkdownAgentDefinition } from '../markdown-agents.js';
import { isToolVisibleForExecutionCapability } from '../../../domain/permissions/index.js';
import {
    getBuiltInAgent,
    filterToolsForAgent,
    renderAgentMemorySnapshot,
    forkSubagentsBatch,
    areAllConcurrencySafe,
    type BuiltInAgent,
    type ForkSpec,
    type ForkableChildSession,
    type ForkChildRunner,
    type AgentMemoryUsage,
    type ParentForkContext,
} from '../subagents/index.js';

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

// ---------------------------------------------------------------------------
// InMemoryChildSession — satisfies ForkableChildSession for the in-process runner
// ---------------------------------------------------------------------------

class InMemoryChildSession implements ForkableChildSession {
    private _messages: LLMMessage[] = [];
    private _usage: AgentMemoryUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    private _readFiles: string[] = [];

    setSystemPrompt(systemPrompt: string): void {
        this._messages = [{ role: 'system', content: systemPrompt }];
    }

    addUserMessage(content: string): void {
        this._messages.push({ role: 'user', content });
    }

    hydrateReadFiles(files: readonly string[]): void {
        this._readFiles = [...files];
    }

    getMessages(): readonly LLMMessage[] { return this._messages; }
    getUsage(): AgentMemoryUsage { return this._usage; }
    getReadFiles(): readonly string[] { return this._readFiles; }

    // Internal helpers used by the runner
    pushMessage(msg: LLMMessage): void { this._messages.push(msg); }
    addUsage(u: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
        this._usage = {
            promptTokens: this._usage.promptTokens + u.promptTokens,
            completionTokens: this._usage.completionTokens + u.completionTokens,
            totalTokens: this._usage.totalTokens + u.totalTokens,
        };
    }
    trackReadFile(filePath: string): void {
        if (!this._readFiles.includes(filePath)) this._readFiles.push(filePath);
    }
}

// ---------------------------------------------------------------------------
// buildRunChild — creates a ForkChildRunner backed by a real LLM provider
// ---------------------------------------------------------------------------

function buildRunChild(
    provider: ILLMProvider,
    registry: DelegateToolRegistry | undefined,
    allowedToolNames: string[],
    context: ToolContext,
): ForkChildRunner {
    return async (session: ForkableChildSession): Promise<void> => {
        const child = session as InMemoryChildSession;
        const MAX_ITERATIONS = 8;

        // Build available tool definitions
        const availableTools: ToolDefinition[] = [];
        if (registry) {
            for (const toolName of allowedToolNames) {
                const tool = registry.get(toolName);
                if (tool && isDelegateToolAllowed(toolName, tool)) {
                    availableTools.push(tool.definition);
                }
            }
        }

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            const response = await provider.complete({
                messages: [...child.getMessages()],
                tools: availableTools.length > 0 ? availableTools : undefined,
                maxTokens: 4096,
                temperature: 0.2,
            });

            child.addUsage(response.usage);

            const toolCalls = response.message.toolCalls;
            if (!toolCalls || toolCalls.length === 0) {
                child.pushMessage({ role: 'assistant', content: response.message.content });
                break;
            }

            child.pushMessage({
                role: 'assistant',
                content: response.message.content || '',
                toolCalls,
            });

            for (const tc of toolCalls) {
                const tool = registry?.get(tc.name);
                if (!registry || !tool) {
                    child.pushMessage({
                        role: 'tool',
                        content: `Error: tool "${tc.name}" not available to sub-agent`,
                        toolCallId: tc.id,
                    });
                    continue;
                }

                if (!isDelegateToolAllowed(tc.name, tool) || !allowedToolNames.includes(tc.name)) {
                    child.pushMessage({
                        role: 'tool',
                        content: `Error: tool "${tc.name}" is not allowed for this sub-agent`,
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

                // Track read_file calls for memory snapshot
                if (tc.name === 'read_file' && typeof parsedArgs['path'] === 'string') {
                    child.trackReadFile(parsedArgs['path']);
                }

                const toolResult = await registry.execute(tc.name, parsedArgs, context, tc.id);
                const output = toolResult.success ? toolResult.output : `Error: ${toolResult.error}`;
                const truncated = output.length > 8000 ? output.slice(0, 8000) + '\n... [truncated]' : output;

                child.pushMessage({ role: 'tool', content: truncated, toolCallId: tc.id });
            }

            if (i === MAX_ITERATIONS - 1) {
                // Ensure there's a final assistant message
                const msgs = child.getMessages();
                const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
                if (!lastAssistant?.content) {
                    child.pushMessage({ role: 'assistant', content: '(sub-agent reached iteration limit)' });
                }
            }
        }
    };
}

// ---------------------------------------------------------------------------
// DelegateTaskTool
// ---------------------------------------------------------------------------

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

    isConcurrencySafe(): boolean {
        return false;
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const task = args.task as string;
        const toolCallId = (args.toolCallId as string) ?? 'delegate';

        if (!task?.trim()) {
            return { toolCallId, success: false, output: '', error: 'Task description is required' };
        }

        const { agentName, agent, allowedToolNames } = resolveAgentAndTools(args, context.cwd, this.parentToolRegistry);

        const emitSubagentStop = () => {
            dispatchLifecycleHookFireAndForget(
                'SubagentStop',
                buildSubagentStopPayload({
                    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
                    cwd: context.cwd,
                    projectRoot: context.projectRoot,
                    stopHookActive: true,
                    subagent: agentName,
                }),
                {
                    cwd: context.cwd,
                    projectRoot: context.projectRoot,
                    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
                    ...(context.hooks ? { hooks: context.hooks } : {}),
                    ...(context.disableAllHooks ? { disableAllHooks: true } : {}),
                    ...(context.logger ? { logger: context.logger } : {}),
                },
            );
        };

        try {
            const provider = await this.providerFactory(this.llmConfig);
            const runChild = buildRunChild(provider, this.parentToolRegistry, allowedToolNames, context);

            const spec: ForkSpec = {
                agent,
                task,
                toolNames: allowedToolNames,
                signal: undefined,
            };

            const parentContext: ParentForkContext = {
                baseSystemPrompt: undefined,
                readFiles: [],
            };

            const createChildSession = (_spec: ForkSpec): ForkableChildSession => new InMemoryChildSession();

            const specs = [spec];
            const outcomes = areAllConcurrencySafe(specs)
                ? await forkSubagentsBatch(parentContext, specs, { createChildSession, runChild })
                : await forkSubagentsBatch(parentContext, specs, { createChildSession, runChild }, { maxConcurrency: 1 });

            const outcome = outcomes[0];
            if (!outcome) {
                return { toolCallId, success: false, output: '', error: 'No fork outcome' };
            }

            if (outcome.status === 'error') {
                return {
                    toolCallId,
                    success: false,
                    output: '',
                    error: `Sub-agent execution failed: ${outcome.error.message}`,
                };
            }

            const snapshot = outcome.result.snapshot;
            const rendered = renderAgentMemorySnapshot(snapshot);

            return {
                toolCallId,
                success: true,
                output: `agent: ${agentName}\n\n${rendered}`,
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Sub-agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        } finally {
            emitSubagentStop();
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAgentAndTools(
    args: Record<string, unknown>,
    cwd: string,
    registry: DelegateToolRegistry | undefined,
): { agentName: string; agent: BuiltInAgent; allowedToolNames: string[] } {
    const mode = String(args.mode ?? '').trim().toLowerCase();
    const rawAgent = String(args.agent ?? '').trim();
    const agentName = rawAgent || (mode === 'plan' ? 'plan' : 'explore');

    const markdownAgent = getMarkdownAgentDefinition(agentName, cwd);
    const builtInAgent = getBuiltInAgent(agentName);

    // Build a BuiltInAgent-compatible object.
    // Markdown agent prompt takes priority over built-in agent prompt when both exist.
    const baseAgent = builtInAgent ?? {
        name: agentName,
        description: markdownAgent?.description ?? agentName,
        systemPrompt: `You are a ${agentName} sub-agent. Complete the delegated task using only the provided safe tools and return a concise, evidence-backed answer.`,
        allowedTools: markdownAgent?.tools ?? ['read_file', 'grep_content', 'glob_files', 'list_files'],
        concurrencySafe: true,
        color: 'cyan',
    };

    const agent: BuiltInAgent = markdownAgent
        ? { ...baseAgent, systemPrompt: markdownAgent.prompt }
        : baseAgent;

    // Compute allowed tool names from the registry pool
    const poolNames = registry
        ? (registry as unknown as { getTools?: () => ITool[] }).getTools?.()?.map((t) => t.definition.name) ?? []
        : READONLY_DELEGATE_TOOLS;

    const fromMarkdown = markdownAgent?.tools;
    const base = fromMarkdown && fromMarkdown.length > 0
        ? fromMarkdown
        : filterToolsForAgent(poolNames.length > 0 ? poolNames : READONLY_DELEGATE_TOOLS, agent);

    const allowedToolNames = Array.from(
        new Set(base.filter((n) => !WRITE_OR_SIDE_EFFECT_TOOLS.has(n))),
    );

    return { agentName, agent, allowedToolNames };
}

function isDelegateToolAllowed(toolName: string, tool: ITool): boolean {
    return isToolVisibleForExecutionCapability(
        toolName,
        'read_only',
        tool.getSecurityPolicyContext?.(),
    );
}
