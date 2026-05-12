// P27b — Feature-gated advanced tools.
//
// MonitorTool, ToolSearchTool, WorkflowTool, PowerShellTool,
// RemoteTriggerTool, REPLTool.
// Each is only registered when its feature flag is enabled.

import * as child_process from 'node:child_process';
import * as vm from 'node:vm';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';

// ---------------------------------------------------------------------------
// MonitorTool (feature: MONITOR_TOOL)
// ---------------------------------------------------------------------------

export class MonitorTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    readonly definition: ToolDefinition = {
        name: 'monitor',
        description: 'Observe session runtime metrics: message count, tool call count, token usage, and elapsed time. Useful for self-monitoring long-running sessions.',
        parameters: [
            { name: 'metric', type: 'string', description: 'Metric to query: messages | tools | tokens | elapsed | all (default: all)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const metric = typeof args['metric'] === 'string' ? args['metric'] : 'all';
        const sessionId = context.sessionId ?? 'unknown';

        const info: Record<string, unknown> = {
            sessionId,
            cwd: context.cwd,
            metric,
            timestamp: new Date().toISOString(),
        };

        return {
            toolCallId,
            success: true,
            output: JSON.stringify(info, null, 2),
            metadata: info,
        };
    }
}

// ---------------------------------------------------------------------------
// ToolSearchTool (feature: TOOL_SEARCH_LAZY)
// ---------------------------------------------------------------------------

export class ToolSearchTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    private readonly toolSummaries: Array<{ name: string; description: string }>;

    constructor(toolSummaries: Array<{ name: string; description: string }> = []) {
        this.toolSummaries = toolSummaries;
    }

    readonly definition: ToolDefinition = {
        name: 'tool_search',
        description: 'Search available tools by keyword. Returns up to 8 matching tools with their descriptions. Use when you need to discover which tool to use for a task.',
        parameters: [
            { name: 'query', type: 'string', description: 'Search query (keywords)', required: true },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const query = typeof args['query'] === 'string' ? args['query'].toLowerCase().trim() : '';
        if (!query) return { toolCallId, success: false, output: '', error: 'query is required' };

        const terms = query.split(/\s+/);
        const scored = this.toolSummaries
            .map((t) => {
                const text = `${t.name} ${t.description}`.toLowerCase();
                const score = terms.filter((term) => text.includes(term)).length;
                return { ...t, score };
            })
            .filter((t) => t.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);

        if (scored.length === 0) {
            return { toolCallId, success: true, output: `No tools found matching: ${query}` };
        }

        const output = scored.map((t) => `- ${t.name}: ${t.description}`).join('\n');
        return {
            toolCallId,
            success: true,
            output: `Found ${scored.length} tool(s) matching "${query}":\n\n${output}`,
            metadata: { results: scored },
        };
    }
}

// ---------------------------------------------------------------------------
// WorkflowTool (feature: WORKFLOW_SCRIPTS)
// ---------------------------------------------------------------------------

export interface WorkflowStep {
    name: string;
    command: string;
    continueOnError?: boolean;
}

export class WorkflowTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'workflow',
        description: 'Run a predefined workflow: a named sequence of shell commands. Each step is executed in order; failures stop the workflow unless continueOnError is set.',
        parameters: [
            {
                name: 'steps',
                type: 'array',
                description: 'Array of steps: { name, command, continueOnError? }',
                required: true,
            },
            { name: 'cwd', type: 'string', description: 'Working directory override', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const rawSteps = args['steps'];
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
            return { toolCallId, success: false, output: '', error: 'steps must be a non-empty array' };
        }

        const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : context.cwd;
        const results: Array<{ name: string; status: 'pass' | 'fail'; output: string }> = [];
        let overallSuccess = true;

        for (const step of rawSteps as WorkflowStep[]) {
            const name = step.name ?? '(unnamed)';
            const command = step.command ?? '';
            if (!command) {
                results.push({ name, status: 'fail', output: 'No command specified' });
                overallSuccess = false;
                if (!step.continueOnError) break;
                continue;
            }

            try {
                const result = child_process.spawnSync('sh', ['-c', command], {
                    cwd,
                    encoding: 'utf-8',
                    timeout: 30_000,
                });
                const output = (result.stdout ?? '') + (result.stderr ?? '');
                const ok = result.status === 0;
                results.push({ name, status: ok ? 'pass' : 'fail', output: output.slice(0, 500) });
                if (!ok) {
                    overallSuccess = false;
                    if (!step.continueOnError) break;
                }
            } catch (err) {
                results.push({ name, status: 'fail', output: (err as Error).message });
                overallSuccess = false;
                if (!step.continueOnError) break;
            }
        }

        const table = results.map((r) => `${r.status === 'pass' ? '✅' : '❌'} ${r.name}: ${r.output.split('\n')[0] ?? ''}`).join('\n');
        return {
            toolCallId,
            success: overallSuccess,
            output: `Workflow: ${results.filter((r) => r.status === 'pass').length}/${results.length} steps passed\n\n${table}`,
            metadata: { results },
        };
    }
}

// ---------------------------------------------------------------------------
// PowerShellTool (feature: POWERSHELL_TOOL, Windows only)
// ---------------------------------------------------------------------------

export class PowerShellTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'powershell',
        description: 'Run a PowerShell command (Windows only). Uses powershell.exe with -NoProfile -NonInteractive flags.',
        parameters: [
            { name: 'command', type: 'string', description: 'PowerShell command to execute', required: true },
            { name: 'timeout_ms', type: 'number', description: 'Timeout in milliseconds (default 30000)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        if (process.platform !== 'win32') {
            return { toolCallId, success: false, output: '', error: 'PowerShellTool is only available on Windows' };
        }

        const command = typeof args['command'] === 'string' ? args['command'] : '';
        if (!command) return { toolCallId, success: false, output: '', error: 'command is required' };

        const timeout = typeof args['timeout_ms'] === 'number' ? args['timeout_ms'] : 30_000;

        try {
            const result = child_process.spawnSync(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', command],
                { cwd: context.cwd, encoding: 'utf-8', timeout },
            );
            const output = (result.stdout ?? '') + (result.stderr ?? '');
            return {
                toolCallId,
                success: result.status === 0,
                output: output.slice(0, 8000),
                ...(result.status !== 0 ? { error: `Exit code: ${result.status}` } : {}),
            };
        } catch (err) {
            return { toolCallId, success: false, output: '', error: (err as Error).message };
        }
    }
}

// ---------------------------------------------------------------------------
// RemoteTriggerTool (feature: REMOTE_TRIGGER_TOOL)
// ---------------------------------------------------------------------------

export class RemoteTriggerTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'remote_trigger',
        description: 'Trigger a task on a remote XQoder daemon via IPC. Requires the daemon to be running. Returns the worker ID of the spawned task.',
        parameters: [
            { name: 'socket_path', type: 'string', description: 'Unix socket path (default: /tmp/xqoder-daemon.sock)', required: false },
            { name: 'session_id', type: 'string', description: 'Session ID to attach to the worker', required: false },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const socketPath = typeof args['socket_path'] === 'string' ? args['socket_path'] : '/tmp/xqoder-daemon.sock';
        const sessionId = typeof args['session_id'] === 'string' ? args['session_id'] : undefined;

        try {
            // Lazy import to avoid loading daemon module when feature is off
            const { createIpcClient } = await import('../../../core/daemon/ipc.js');
            const client = await createIpcClient(socketPath);
            const result = await client.call('spawn', { sessionId });
            client.close();
            return {
                toolCallId,
                success: true,
                output: JSON.stringify(result, null, 2),
                metadata: result as Record<string, unknown>,
            };
        } catch (err) {
            return { toolCallId, success: false, output: '', error: `Failed to connect to daemon: ${(err as Error).message}` };
        }
    }
}

// ---------------------------------------------------------------------------
// REPLTool (feature: REPL_TOOL)
// ---------------------------------------------------------------------------

const REPL_TIMEOUT_MS = 5_000;
const REPL_MAX_OUTPUT = 4_000;

export class REPLTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'repl',
        description: 'Execute JavaScript code in a sandboxed Node.js VM context. Returns the result of the last expression. Useful for quick calculations, data transformations, and scripting.',
        parameters: [
            { name: 'code', type: 'string', description: 'JavaScript code to execute', required: true },
            { name: 'timeout_ms', type: 'number', description: 'Execution timeout in milliseconds (default 5000, max 10000)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const code = typeof args['code'] === 'string' ? args['code'] : '';
        if (!code.trim()) return { toolCallId, success: false, output: '', error: 'code is required' };

        const timeout = Math.min(
            typeof args['timeout_ms'] === 'number' ? args['timeout_ms'] : REPL_TIMEOUT_MS,
            10_000,
        );

        const logs: string[] = [];
        const sandbox = {
            console: {
                log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
                error: (...a: unknown[]) => logs.push('[err] ' + a.map(String).join(' ')),
                warn: (...a: unknown[]) => logs.push('[warn] ' + a.map(String).join(' ')),
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
        };

        try {
            const context = vm.createContext(sandbox);
            const result = vm.runInContext(code, context, { timeout });
            const output = [
                ...logs,
                result !== undefined ? `=> ${JSON.stringify(result)}` : '',
            ].filter(Boolean).join('\n').slice(0, REPL_MAX_OUTPUT);

            return { toolCallId, success: true, output: output || '(no output)' };
        } catch (err) {
            return { toolCallId, success: false, output: logs.join('\n'), error: (err as Error).message };
        }
    }
}
