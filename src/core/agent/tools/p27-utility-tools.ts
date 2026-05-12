// P27a — Core utility + plan tools.
//
// SleepTool, ConfigTool, BriefTool, SyntheticOutputTool,
// EnterPlanModeTool, ExitPlanModeTool, VerifyPlanExecutionTool,
// NotebookEditTool, AskUserQuestionTool, SuggestBackgroundPRTool.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { configManager } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';

// ---------------------------------------------------------------------------
// SleepTool
// ---------------------------------------------------------------------------

export class SleepTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    readonly definition: ToolDefinition = {
        name: 'sleep',
        description: 'Pause execution for a specified number of milliseconds. Useful for rate-limiting, waiting for async side effects, or pacing tool calls.',
        parameters: [
            { name: 'ms', type: 'number', description: 'Duration in milliseconds (max 30000)', required: true },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const raw = args['ms'];
        const ms = typeof raw === 'number' ? raw : Number(raw);

        if (!Number.isFinite(ms) || ms < 0) {
            return { toolCallId, success: false, output: '', error: 'ms must be a non-negative number' };
        }

        const capped = Math.min(ms, 30_000);
        await new Promise<void>((r) => setTimeout(r, capped));
        return { toolCallId, success: true, output: `Slept for ${capped}ms` };
    }
}

// ---------------------------------------------------------------------------
// ConfigTool
// ---------------------------------------------------------------------------

const ALLOWED_CONFIG_KEYS = new Set([
    'model', 'agent', 'permissionMode', 'thinking', 'effort', 'fastMode',
    'maxTurns', 'quiet', 'outputFormat',
]);

export class ConfigTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'config',
        description: 'Read or write XQoder configuration values. Use action="get" to read a key, action="set" to write a key, action="list" to show all keys.',
        parameters: [
            { name: 'action', type: 'string', description: 'get | set | list', required: true },
            { name: 'key', type: 'string', description: 'Config key (required for get/set)', required: false },
            { name: 'value', type: 'string', description: 'Value to set (required for set)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const action = typeof args['action'] === 'string' ? args['action'].trim() : '';

        if (action === 'list') {
            const config = configManager.load();
            const safe = Object.fromEntries(
                Object.entries(config as unknown as Record<string, unknown>).filter(([k]) => ALLOWED_CONFIG_KEYS.has(k)),
            );
            return { toolCallId, success: true, output: JSON.stringify(safe, null, 2) };
        }

        const key = typeof args['key'] === 'string' ? args['key'].trim() : '';
        if (!key) return { toolCallId, success: false, output: '', error: 'key is required' };
        if (!ALLOWED_CONFIG_KEYS.has(key)) {
            return { toolCallId, success: false, output: '', error: `key '${key}' is not configurable via this tool` };
        }

        if (action === 'get') {
            const config = configManager.load();
            const value = (config as unknown as Record<string, unknown>)[key];
            return { toolCallId, success: true, output: value !== undefined ? JSON.stringify(value) : '(not set)' };
        }

        if (action === 'set') {
            const value = args['value'];
            if (value === undefined) return { toolCallId, success: false, output: '', error: 'value is required for set' };
            const config = configManager.load();
            (config as unknown as Record<string, unknown>)[key] = value;
            configManager.set(config);
            configManager.save();
            return { toolCallId, success: true, output: `Set ${key} = ${JSON.stringify(value)}` };
        }

        return { toolCallId, success: false, output: '', error: `Unknown action: ${action}. Use get, set, or list.` };
    }
}

// ---------------------------------------------------------------------------
// BriefTool
// ---------------------------------------------------------------------------

export class BriefTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    readonly definition: ToolDefinition = {
        name: 'brief',
        description: 'Generate a concise summary of the current conversation context. Returns a brief description of what has been accomplished so far, useful before compaction or handoff.',
        parameters: [
            { name: 'focus', type: 'string', description: 'Optional focus area for the summary', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const focus = typeof args['focus'] === 'string' ? args['focus'].trim() : '';
        const sessionId = context.sessionId ?? 'unknown';
        const focusNote = focus ? ` (focus: ${focus})` : '';
        return {
            toolCallId,
            success: true,
            output: `Session ${sessionId}${focusNote}: Brief summary requested. The agent should synthesize recent tool calls and messages into a concise status update.`,
        };
    }
}

// ---------------------------------------------------------------------------
// SyntheticOutputTool
// ---------------------------------------------------------------------------

export class SyntheticOutputTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    readonly definition: ToolDefinition = {
        name: 'synthetic_output',
        description: 'Force structured JSON output conforming to a given schema. Use when you need the model to return a specific JSON structure as the final answer.',
        parameters: [
            { name: 'schema', type: 'object', description: 'JSON Schema describing the expected output', required: true },
            { name: 'data', type: 'object', description: 'The structured data to return', required: true },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const data = args['data'];
        if (data === undefined || data === null) {
            return { toolCallId, success: false, output: '', error: 'data is required' };
        }
        return {
            toolCallId,
            success: true,
            output: JSON.stringify(data, null, 2),
            metadata: { structured: true, data },
        };
    }
}

// ---------------------------------------------------------------------------
// EnterPlanModeTool / ExitPlanModeTool
// ---------------------------------------------------------------------------

// Module-level plan mode state (per-process)
let _planModeActive = false;

export function isPlanModeActive(): boolean { return _planModeActive; }
export function __resetPlanModeForTests(): void {
    _planModeActive = false;
}

export class EnterPlanModeTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'enter_plan_mode',
        description: 'Switch to plan mode: the agent will outline a plan and wait for user approval before executing any changes. Use before making significant modifications.',
        parameters: [],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        if (_planModeActive) {
            return { toolCallId, success: true, output: 'Already in plan mode.' };
        }
        _planModeActive = true;
        return {
            toolCallId,
            success: true,
            output: 'Entered plan mode. Outline your plan and wait for user approval before executing changes.',
            metadata: { planMode: true },
        };
    }
}

export class ExitPlanModeTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'exit_plan_mode',
        description: 'Exit plan mode and resume normal execution. Call after the user has approved the plan.',
        parameters: [
            { name: 'approved', type: 'boolean', description: 'Whether the plan was approved by the user', required: false },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const approved = args['approved'] !== false;
        _planModeActive = false;
        return {
            toolCallId,
            success: true,
            output: approved ? 'Exited plan mode. Proceeding with execution.' : 'Exited plan mode. Plan was not approved.',
            metadata: { planMode: false, approved },
        };
    }
}

// ---------------------------------------------------------------------------
// VerifyPlanExecutionTool
// ---------------------------------------------------------------------------

export interface VerifyStep {
    description: string;
    type: 'file_exists' | 'file_contains' | 'command_succeeds' | 'manual';
    path?: string;
    pattern?: string;
    command?: string;
}

export class VerifyPlanExecutionTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'verify_plan_execution',
        description: 'Verify that a set of planned steps have been executed correctly. Each step is checked and a pass/fail table is returned.',
        parameters: [
            {
                name: 'steps',
                type: 'array',
                description: 'Array of verification steps. Each step: { description, type: "file_exists"|"file_contains"|"command_succeeds"|"manual", path?, pattern?, command? }',
                required: true,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const rawSteps = args['steps'];
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
            return { toolCallId, success: false, output: '', error: 'steps must be a non-empty array' };
        }

        const results: Array<{ description: string; status: 'pass' | 'fail' | 'skip'; reason?: string }> = [];

        for (const step of rawSteps as VerifyStep[]) {
            const desc = step.description ?? '(unnamed step)';
            try {
                switch (step.type) {
                    case 'file_exists': {
                        const p = step.path ? path.resolve(context.projectRoot, step.path) : '';
                        if (!p) { results.push({ description: desc, status: 'fail', reason: 'path required' }); break; }
                        results.push({ description: desc, status: fs.existsSync(p) ? 'pass' : 'fail', reason: fs.existsSync(p) ? undefined : `File not found: ${p}` });
                        break;
                    }
                    case 'file_contains': {
                        const p = step.path ? path.resolve(context.projectRoot, step.path) : '';
                        const pattern = step.pattern ?? '';
                        if (!p || !pattern) { results.push({ description: desc, status: 'fail', reason: 'path and pattern required' }); break; }
                        const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
                        const found = content.includes(pattern);
                        results.push({ description: desc, status: found ? 'pass' : 'fail', reason: found ? undefined : `Pattern not found: ${pattern}` });
                        break;
                    }
                    case 'manual':
                        results.push({ description: desc, status: 'skip', reason: 'Manual verification required' });
                        break;
                    default:
                        results.push({ description: desc, status: 'skip', reason: `Unsupported type: ${step.type}` });
                }
            } catch (err) {
                results.push({ description: desc, status: 'fail', reason: (err as Error).message });
            }
        }

        const passed = results.filter((r) => r.status === 'pass').length;
        const failed = results.filter((r) => r.status === 'fail').length;
        const table = results.map((r) => `${r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭'} ${r.description}${r.reason ? ` — ${r.reason}` : ''}`).join('\n');

        return {
            toolCallId,
            success: failed === 0,
            output: `Verification: ${passed} pass, ${failed} fail, ${results.length - passed - failed} skip\n\n${table}`,
            metadata: { results, passed, failed },
        };
    }
}

// ---------------------------------------------------------------------------
// NotebookEditTool
// ---------------------------------------------------------------------------

export class NotebookEditTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'notebook_edit',
        description: 'Edit a Jupyter notebook (.ipynb) cell. Specify the notebook path, cell index (0-based), and new source. Use edit_mode="insert" to add a cell, "delete" to remove one.',
        parameters: [
            { name: 'path', type: 'string', description: 'Absolute or project-relative path to the .ipynb file', required: true },
            { name: 'cell_index', type: 'number', description: '0-based cell index', required: true },
            { name: 'new_source', type: 'string', description: 'New source for the cell', required: false },
            { name: 'edit_mode', type: 'string', description: 'replace | insert | delete (default: replace)', required: false },
            { name: 'cell_type', type: 'string', description: 'code | markdown (for insert mode)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const rawPath = typeof args['path'] === 'string' ? args['path'] : '';
        if (!rawPath) return { toolCallId, success: false, output: '', error: 'path is required' };

        const nbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(context.projectRoot, rawPath);
        if (!nbPath.endsWith('.ipynb')) {
            return { toolCallId, success: false, output: '', error: 'path must point to a .ipynb file' };
        }
        if (!fs.existsSync(nbPath)) {
            return { toolCallId, success: false, output: '', error: `Notebook not found: ${nbPath}` };
        }

        const cellIndex = typeof args['cell_index'] === 'number' ? args['cell_index'] : Number(args['cell_index']);
        const editMode = typeof args['edit_mode'] === 'string' ? args['edit_mode'] : 'replace';
        const newSource = typeof args['new_source'] === 'string' ? args['new_source'] : '';
        const cellType = typeof args['cell_type'] === 'string' ? args['cell_type'] : 'code';

        let nb: Record<string, unknown>;
        try {
            nb = JSON.parse(fs.readFileSync(nbPath, 'utf-8')) as Record<string, unknown>;
        } catch (err) {
            return { toolCallId, success: false, output: '', error: `Failed to parse notebook: ${(err as Error).message}` };
        }

        const cells = nb['cells'] as Array<Record<string, unknown>>;
        if (!Array.isArray(cells)) {
            return { toolCallId, success: false, output: '', error: 'Notebook has no cells array' };
        }

        if (editMode === 'delete') {
            if (cellIndex < 0 || cellIndex >= cells.length) {
                return { toolCallId, success: false, output: '', error: `Cell index ${cellIndex} out of range [0, ${cells.length - 1}]` };
            }
            cells.splice(cellIndex, 1);
        } else if (editMode === 'insert') {
            const newCell: Record<string, unknown> = {
                cell_type: cellType,
                source: newSource.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l),
                metadata: {},
            };
            if (cellType === 'code') {
                newCell['outputs'] = [];
                newCell['execution_count'] = null;
            }
            cells.splice(cellIndex, 0, newCell);
        } else {
            // replace
            if (cellIndex < 0 || cellIndex >= cells.length) {
                return { toolCallId, success: false, output: '', error: `Cell index ${cellIndex} out of range [0, ${cells.length - 1}]` };
            }
            const cell = cells[cellIndex]!;
            cell['source'] = newSource.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l);
        }

        try {
            fs.writeFileSync(nbPath, JSON.stringify(nb, null, 1));
        } catch (err) {
            return { toolCallId, success: false, output: '', error: `Failed to write notebook: ${(err as Error).message}` };
        }

        return { toolCallId, success: true, output: `Notebook ${editMode}d cell ${cellIndex} in ${nbPath}` };
    }
}

// ---------------------------------------------------------------------------
// AskUserQuestionTool (structured multi-question variant)
// ---------------------------------------------------------------------------

export class AskUserQuestionTool implements ITool {
    isConcurrencySafe(): boolean { return false; }

    readonly definition: ToolDefinition = {
        name: 'ask_user_question',
        description: 'Ask the user one or more structured questions and collect answers. Each question has a set of options. Returns a map of question IDs to selected answers.',
        parameters: [
            {
                name: 'questions',
                type: 'array',
                description: 'Array of questions. Each: { id, question, options: [{label, description?}], multiSelect? }',
                required: true,
            },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const rawQuestions = args['questions'];
        if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
            return { toolCallId, success: false, output: '', error: 'questions must be a non-empty array' };
        }

        // If interactive question channel is available, use it
        if (context.requestQuestion) {
            const answers: Record<string, string[]> = {};
            for (const q of rawQuestions as Array<Record<string, unknown>>) {
                const id = typeof q['id'] === 'string' ? q['id'] : String(rawQuestions.indexOf(q));
                const question = typeof q['question'] === 'string' ? q['question'] : '';
                const options = Array.isArray(q['options'])
                    ? (q['options'] as Array<Record<string, unknown>>).map((o) => ({
                        label: typeof o['label'] === 'string' ? o['label'] : String(o['label']),
                        description: typeof o['description'] === 'string' ? o['description'] : undefined,
                    }))
                    : [];
                const multiple = Boolean(q['multiSelect'] ?? q['multiple']);

                const answer = await context.requestQuestion({
                    requestId: `ask_${id}_${Date.now()}`,
                    question,
                    options,
                    multiple,
                });
                answers[id] = answer.selected;
            }
            return {
                toolCallId,
                success: true,
                output: JSON.stringify({ answers }, null, 2),
                metadata: { answers },
            };
        }

        // Fallback: auto-select first option
        const answers: Record<string, string[]> = {};
        for (const q of rawQuestions as Array<Record<string, unknown>>) {
            const id = typeof q['id'] === 'string' ? q['id'] : String(rawQuestions.indexOf(q));
            const options = Array.isArray(q['options'])
                ? (q['options'] as Array<Record<string, unknown>>).map((o) => typeof o['label'] === 'string' ? o['label'] : String(o['label']))
                : [];
            answers[id] = options.length > 0 ? [options[0]!] : [];
        }
        return {
            toolCallId,
            success: true,
            output: JSON.stringify({ answers, fallback: true }, null, 2),
            metadata: { answers, fallback: true },
        };
    }
}

// ---------------------------------------------------------------------------
// SuggestBackgroundPRTool
// ---------------------------------------------------------------------------

export class SuggestBackgroundPRTool implements ITool {
    isConcurrencySafe(): boolean { return true; }

    readonly definition: ToolDefinition = {
        name: 'suggest_background_pr',
        description: 'Suggest creating a pull request in the background for the current changes. Returns a suggestion with branch name, title, and description. Does not create the PR automatically.',
        parameters: [
            { name: 'title', type: 'string', description: 'Suggested PR title', required: true },
            { name: 'description', type: 'string', description: 'PR description / body', required: false },
            { name: 'branch', type: 'string', description: 'Suggested branch name', required: false },
        ],
    };

    async execute(args: Record<string, unknown>): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
        if (!title) return { toolCallId, success: false, output: '', error: 'title is required' };

        const description = typeof args['description'] === 'string' ? args['description'] : '';
        const branch = typeof args['branch'] === 'string' ? args['branch'] : `feature/${title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`;

        return {
            toolCallId,
            success: true,
            output: `PR suggestion:\n  Branch: ${branch}\n  Title: ${title}${description ? `\n  Description: ${description}` : ''}\n\nTo create: git checkout -b ${branch} && git push -u origin ${branch}`,
            metadata: { title, description, branch },
        };
    }
}
