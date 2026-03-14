import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, QuestionPrompt, ToolContext } from './tool.js';
import { resolvePathWithinProject } from './sandbox.js';

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const TODO_PRIORITIES = new Set(['high', 'medium', 'low']);

interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority: 'high' | 'medium' | 'low';
}

export class SkillTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'skill',
        description: '加载项目或用户技能文档内容，帮助 agent 按约定流程执行任务。',
        parameters: [
            { name: 'name', type: 'string', description: '技能名（例如 django-verification）', required: false },
            { name: 'filePath', type: 'string', description: '技能文件路径（相对项目目录）', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const skillName = typeof args['name'] === 'string' ? args['name'].trim() : '';
        const filePath = typeof args['filePath'] === 'string' ? args['filePath'].trim() : '';

        let targetPath: string | undefined;

        if (filePath) {
            targetPath = resolvePathWithinProject(filePath, context);
        } else if (skillName) {
            targetPath = resolveSkillPath(skillName, context.projectRoot);
        }

        if (!targetPath) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: '请提供 name 或 filePath 来加载技能文档',
            };
        }

        if (!fs.existsSync(targetPath)) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `技能文件不存在: ${targetPath}`,
            };
        }

        const content = fs.readFileSync(targetPath, 'utf-8');
        const renderedName = skillName || path.basename(path.dirname(targetPath));

        return {
            toolCallId,
            success: true,
            output: `<skill_content name="${renderedName}">\n${content}\n</skill_content>`,
            metadata: {
                path: targetPath,
                bytes: Buffer.byteLength(content, 'utf-8'),
            },
        };
    }
}

export class TodoWriteTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'todowrite',
        description: '写入结构化任务列表，用于跟踪当前会话中的执行计划。',
        parameters: [
            { name: 'todos', type: 'array', description: '任务数组，每项包含 content/status/priority', required: true },
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
                error: '参数 todos 非法：需要数组，且每项必须包含 content/status/priority',
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
            output: `已更新任务列表 (${todos.length} 项):\n${summary}`,
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
    readonly definition: ToolDefinition = {
        name: 'todoread',
        description: '读取结构化任务列表，返回当前会话最近一次写入的 todo 状态。',
        parameters: [
            { name: 'filePath', type: 'string', description: '可选：todo 文件路径（相对项目目录）', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const filePathArg = typeof args['filePath'] === 'string' ? args['filePath'].trim() : '';
        const targetPath = filePathArg
            ? resolvePathWithinProject(filePathArg, context)
            : getTodoStatePath(context.projectRoot);

        if (!fs.existsSync(targetPath)) {
            const empty = {
                sessionId: context.sessionId,
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
                error: `读取 todo 失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

export class QuestionTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'question',
        description: '提出结构化问题。在当前无交互问答通道时，自动返回推荐答案以继续执行。',
        parameters: [
            { name: 'question', type: 'string', description: '问题正文', required: true },
            { name: 'header', type: 'string', description: '问题标题', required: false },
            { name: 'options', type: 'array', description: '选项数组，每项可含 label/description', required: false },
            { name: 'multiple', type: 'boolean', description: '是否多选', required: false },
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
                error: '参数 question 不能为空',
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
                output: `${outputPrefix}${question}\n用户选择: ${selected.length > 0 ? selected.join(', ') : '未选择'}${answer.customText ? `\n用户补充: ${answer.customText}` : ''}`,
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
            output: `${prefix}${question}\n自动选择: ${selected.length > 0 ? selected.join(', ') : '无选项，继续等待用户自然语言回复'}\n说明: 当前运行时暂无结构化提问交互通道，已使用默认选项继续。`,
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

function resolveSkillPath(name: string, projectRoot: string): string | undefined {
    const safeName = sanitizeSkillName(name);
    if (!safeName) {
        return undefined;
    }

    const home = os.homedir();
    const candidates = [
        path.join(projectRoot, '.xqoder', 'skills', `${safeName}.md`),
        path.join(projectRoot, '.xqoder', 'skills', safeName, 'SKILL.md'),
        path.join(projectRoot, '.opencode', 'skills', `${safeName}.md`),
        path.join(projectRoot, '.opencode', 'skills', safeName, 'SKILL.md'),
        path.join(home, '.agents', 'skills', safeName, 'SKILL.md'),
        path.join(home, '.xqoder', 'skills', `${safeName}.md`),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function sanitizeSkillName(name: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return undefined;
    return trimmed;
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
