import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, QuestionPrompt, ToolContext } from './tool.js';
import { resolvePathWithinProject } from './sandbox.js';
import { resolveSkillDocumentPath } from './skill-paths.js';
import { detectSkillCandidates, loadSkillRegistry, type SkillFile } from '../../skills/index.js';

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const TODO_PRIORITIES = new Set(['high', 'medium', 'low']);

interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority: 'high' | 'medium' | 'low';
}

interface TodoStatePayload {
    sessionId: string;
    updatedAt: string | null;
    todos: TodoItem[];
}

export class SkillTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'skill',
        description: 'Query or activate a skill. Use action:"list" to see available skills (optionally ranked by a prompt); use action:"activate" (default) with {name} or {filePath} to load the full skill body. Activating a skill with a `tools` frontmatter field surfaces those tool names as advisory metadata.',
        parameters: [
            { name: 'action', type: 'string', description: 'Either "list" or "activate" (default: activate)', required: false },
            { name: 'name', type: 'string', description: 'Skill name (e.g., django-verification)', required: false },
            { name: 'filePath', type: 'string', description: 'Skill file path (relative to project directory)', required: false },
            { name: 'prompt', type: 'string', description: 'Optional prompt used to rank skills when action="list"', required: false },
            { name: 'topN', type: 'number', description: 'Limit for ranked list (default 5)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const action = normalizeSkillAction(args['action']);

        if (action === 'list') {
            return executeSkillList(args, context, toolCallId);
        }

        return executeSkillActivate(args, context, toolCallId);
    }
}

function normalizeSkillAction(raw: unknown): 'list' | 'activate' {
    if (typeof raw !== 'string') return 'activate';
    const lower = raw.trim().toLowerCase();
    return lower === 'list' ? 'list' : 'activate';
}

async function executeSkillActivate(
    args: Record<string, unknown>,
    context: ToolContext,
    toolCallId: string,
): Promise<ToolResult> {
    const skillName = typeof args['name'] === 'string' ? args['name'].trim() : '';
    const filePath = typeof args['filePath'] === 'string' ? args['filePath'].trim() : '';

    let targetPath: string | undefined;
    if (filePath) {
        targetPath = resolvePathWithinProject(filePath, context);
    } else if (skillName) {
        targetPath = resolveSkillDocumentPath(skillName, context.projectRoot);
    }

    if (!targetPath) {
        return {
            toolCallId,
            success: false,
            output: '',
            error: 'Please provide name or filePath to load the skill document',
        };
    }

    if (!fs.existsSync(targetPath)) {
        return {
            toolCallId,
            success: false,
            output: '',
            error: `Skill file does not exist: ${targetPath}`,
        };
    }

    const content = fs.readFileSync(targetPath, 'utf-8');
    const renderedName = skillName || path.basename(path.dirname(targetPath));

    // Best-effort: resolve the structured skill entry (if the file has
    // frontmatter) so we can surface allowed-tools metadata to the
    // permission layer / UI. This is advisory only — the SkillTool does
    // not reach into permission-gate here; that wiring happens in a later
    // phase.
    const structured = findSkillEntry(context.projectRoot, skillName, targetPath);
    const allowedTools = structured?.tools ?? [];

    return {
        toolCallId,
        success: true,
        output: `<skill_content name="${renderedName}">\n${content}\n</skill_content>`,
        metadata: {
            path: targetPath,
            bytes: Buffer.byteLength(content, 'utf-8'),
            activatedSkill: structured?.name ?? renderedName,
            ...(allowedTools.length > 0 ? { allowedTools } : {}),
        },
    };
}

async function executeSkillList(
    args: Record<string, unknown>,
    context: ToolContext,
    toolCallId: string,
): Promise<ToolResult> {
    const prompt = typeof args['prompt'] === 'string' ? args['prompt'].trim() : '';
    const topNRaw = args['topN'];
    const topN = typeof topNRaw === 'number' && Number.isFinite(topNRaw) && topNRaw > 0
        ? Math.floor(topNRaw)
        : 5;

    const registry = loadSkillRegistry(context.projectRoot);
    if (registry.skills.length === 0) {
        return {
            toolCallId,
            success: true,
            output: 'No skills found under .xqoder/skills, .claude/skills, or user-level equivalents.',
            metadata: { skillCount: 0, ranked: false },
        };
    }

    let ranked = false;
    let listing: Array<{ name: string; description: string; triggers: readonly string[] }>;
    if (prompt) {
        const candidates = detectSkillCandidates(prompt, registry.skills, { topN });
        if (candidates.length > 0) {
            ranked = true;
            listing = candidates.map((candidate) => ({
                name: candidate.skill.name,
                description: candidate.skill.description,
                triggers: candidate.matchedTriggers,
            }));
        } else {
            listing = registry.skills.slice(0, topN).map((skill) => ({
                name: skill.name,
                description: skill.description,
                triggers: skill.triggers,
            }));
        }
    } else {
        listing = registry.skills.slice(0, topN).map((skill) => ({
            name: skill.name,
            description: skill.description,
            triggers: skill.triggers,
        }));
    }

    const summary = listing
        .map((entry) => {
            const triggers = entry.triggers.length > 0 ? ` [${entry.triggers.join(', ')}]` : '';
            return `- ${entry.name}${triggers}: ${entry.description}`;
        })
        .join('\n');

    const preamble = ranked
        ? `Top ${listing.length} skills for prompt:`
        : `Available skills (${registry.skills.length}):`;

    return {
        toolCallId,
        success: true,
        output: `${preamble}\n${summary}`,
        metadata: {
            skillCount: registry.skills.length,
            ranked,
            results: listing.map((entry) => entry.name),
        },
    };
}

function findSkillEntry(
    projectRoot: string,
    skillName: string,
    targetPath: string,
): SkillFile | undefined {
    try {
        const registry = loadSkillRegistry(projectRoot);
        if (skillName) {
            const byName = registry.get(skillName);
            if (byName) return byName;
        }
        return registry.skills.find((entry) => entry.filePath === targetPath);
    } catch {
        return undefined;
    }
}

export class TodoWriteTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'todowrite',
        description: 'Write a structured task list to track the execution plan in the current session.',
        parameters: [
            { name: 'todos', type: 'array', description: 'Array of tasks, each containing content/status/priority', required: true },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const todos = normalizeTodos(args['todos']);

        if (!todos) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'Invalid parameter todos: array required, and each item must contain content/status/priority',
            };
        }

        const outputFile = getTodoStatePath(context.projectRoot);
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        const payload = {
            sessionId: context.sessionId,
            updatedAt: new Date().toISOString(),
            todos,
        };
        const serialized = JSON.stringify(payload, null, 2);
        fs.writeFileSync(outputFile, serialized, 'utf-8');

        const summary = todos.map((item, index) => `${index + 1}. [${item.status}] (${item.priority}) ${item.content}`).join('\n');

        return {
            toolCallId,
            success: true,
            output: `Task list updated (${todos.length} items):\n${summary}`,
            metadata: {
                path: outputFile,
                changeType: 'write',
                bytes: Buffer.byteLength(serialized, 'utf-8'),
                todoCount: todos.length,
            },
        };
    }
}

export class TodoReadTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    readonly definition: ToolDefinition = {
        name: 'todoread',
        description: 'Read the structured task list and return the last written todo state for the current session.',
        parameters: [
            { name: 'filePath', type: 'string', description: 'Optional: todo file path (relative to project directory)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const filePathArg = typeof args['filePath'] === 'string' ? args['filePath'].trim() : '';
        const targetPath = filePathArg
            ? resolvePathWithinProject(filePathArg, context)
            : getTodoStatePath(context.projectRoot);

        if (!fs.existsSync(targetPath)) {
            const empty: TodoStatePayload = {
                sessionId: context.sessionId ?? '',
                updatedAt: null,
                todos: [],
            };
            return {
                toolCallId,
                success: true,
                output: JSON.stringify(empty, null, 2),
                metadata: {
                    path: targetPath,
                    todoCount: 0,
                    exists: false,
                },
            };
        }

        try {
            const raw = fs.readFileSync(targetPath, 'utf-8');
            const parsed = JSON.parse(raw) as {
                sessionId?: string;
                updatedAt?: string;
                todos?: unknown;
            };
            const todos = normalizeTodos(parsed.todos) ?? [];
            const payload = {
                sessionId: parsed.sessionId ?? context.sessionId,
                updatedAt: parsed.updatedAt ?? null,
                todos,
            };

            return {
                toolCallId,
                success: true,
                output: JSON.stringify(payload, null, 2),
                metadata: {
                    path: targetPath,
                    todoCount: todos.length,
                    exists: true,
                },
            };
        } catch (err) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `Failed to read todo: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class QuestionTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    readonly definition: ToolDefinition = {
        name: 'question',
        description: 'Ask structured questions. Automatically returns a recommended answer to continue execution when there is no interactive question channel.',
        parameters: [
            { name: 'question', type: 'string', description: 'Question text', required: true },
            { name: 'header', type: 'string', description: 'Question title', required: false },
            { name: 'options', type: 'array', description: 'Array of options, each can contain label/description', required: false },
            { name: 'multiple', type: 'boolean', description: 'Whether to allow multiple selection', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const question = typeof args['question'] === 'string' ? args['question'].trim() : '';
        const header = typeof args['header'] === 'string' ? args['header'].trim() : '';
        const options = normalizeQuestionOptions(args['options']);
        const multiple = Boolean(args['multiple']);
        const allowCustom = Boolean(args['allowCustom'] ?? args['custom']);

        if (!question) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'The question parameter cannot be empty',
            };
        }

        const requestId = toolCallId || `question_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const prompt: QuestionPrompt = {
            requestId,
            question,
            ...(header ? { header } : {}),
            options,
            multiple,
            allowCustom,
        };

        if (context.requestQuestion) {
            const answer = await context.requestQuestion(prompt);
            const selected = normalizeSelectedAnswer(answer.selected, options, multiple);
            const outputPrefix = header ? `${header}\n` : '';
            return {
                toolCallId,
                success: true,
                output: `${outputPrefix}${question}\nUser selected: ${selected.length > 0 ? selected.join(', ') : 'None'}${answer.customText ? `\nUser comment: ${answer.customText}` : ''}`,
                metadata: {
                    selected,
                    customText: answer.customText,
                    multiple,
                    options,
                    interactive: true,
                },
            };
        }

        const selected = options.length > 0 ? [options[0].label] : [];
        const prefix = header ? `${header}\n` : '';

        return {
            toolCallId,
            success: true,
            output: `${prefix}${question}\nAuto-selected: ${selected.length > 0 ? selected.join(', ') : 'No options, waiting for user natural language reply'}\nNote: No structured question channel available in current runtime; default option used to continue.`,
            metadata: {
                selected,
                multiple,
                options,
                interactive: false,
                fallback: true,
            },
        };
    }
}

function normalizeTodos(raw: unknown): TodoItem[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const todos: TodoItem[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            return undefined;
        }
        const record = item as Record<string, unknown>;
        const content = typeof record['content'] === 'string' ? record['content'].trim() : '';
        const statusValue = typeof record['status'] === 'string' ? record['status'] : 'pending';
        const priorityValue = typeof record['priority'] === 'string' ? record['priority'] : 'medium';

        if (!content || !TODO_STATUSES.has(statusValue) || !TODO_PRIORITIES.has(priorityValue)) {
            return undefined;
        }

        todos.push({
            content,
            status: statusValue as TodoItem['status'],
            priority: priorityValue as TodoItem['priority'],
        });
    }

    return todos;
}

function normalizeQuestionOptions(raw: unknown): Array<{ label: string; description?: string }> {
    if (!Array.isArray(raw)) {
        return [];
    }

    const options: Array<{ label: string; description?: string }> = [];
    for (const option of raw) {
        if (!option || typeof option !== 'object') {
            continue;
        }
        const record = option as Record<string, unknown>;
        const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
        if (!label) {
            continue;
        }
        const description = typeof record['description'] === 'string' && record['description'].trim()
            ? record['description'].trim()
            : undefined;
        options.push(description ? { label, description } : { label });
    }
    return options;
}

function normalizeSelectedAnswer(
    selectedRaw: string[] | undefined,
    options: Array<{ label: string; description?: string }>,
    multiple: boolean,
): string[] {
    const allowed = new Set(options.map((option) => option.label));
    const selected = (selectedRaw ?? []).filter((value) => allowed.has(value));
    if (multiple) {
        return selected;
    }
    return selected.length > 0 ? [selected[0]!] : [];
}

function getTodoStatePath(projectRoot: string): string {
    return path.join(projectRoot, '.xqoder', 'state', 'todo.json');
}
