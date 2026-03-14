import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuestionTool, SkillTool, TodoReadTool, TodoWriteTool } from './interaction-tools.js';

const tempDirs: string[] = [];

function createContext() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-interaction-tools-'));
    tempDirs.push(projectRoot);
    return {
        projectRoot,
        cwd: projectRoot,
        sessionId: 'session-test',
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('interaction tools', () => {
    it('loads skill content from project skills directory by name', async () => {
        const context = createContext();
        const skillDir = path.join(context.projectRoot, '.xqoder', 'skills');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'coding-standards.md'), '# Coding Standards\nUse tests first.', 'utf-8');

        const result = await new SkillTool().execute({
            name: 'coding-standards',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('<skill_content name="coding-standards">');
        expect(result.output).toContain('Use tests first.');
    });

    it('writes normalized todo list to project state file', async () => {
        const context = createContext();
        const result = await new TodoWriteTool().execute({
            toolCallId: '1',
            todos: [
                { content: 'Implement parity checklist', status: 'in_progress', priority: 'high' },
                { content: 'Run regression tests', status: 'pending', priority: 'medium' },
            ],
        }, context);

        expect(result.success).toBe(true);
        const todoFile = path.join(context.projectRoot, '.xqoder', 'state', 'todo.json');
        expect(fs.existsSync(todoFile)).toBe(true);
        const saved = JSON.parse(fs.readFileSync(todoFile, 'utf-8')) as {
            sessionId?: string;
            todos: Array<{ content: string; status: string; priority: string }>;
        };
        expect(saved.sessionId).toBe('session-test');
        expect(saved.todos).toHaveLength(2);
        expect(saved.todos[0]).toMatchObject({
            content: 'Implement parity checklist',
            status: 'in_progress',
            priority: 'high',
        });
    });

    it('reads todo list from persisted state file', async () => {
        const context = createContext();
        await new TodoWriteTool().execute({
            toolCallId: 'write-1',
            todos: [
                { content: 'Implement parity checklist', status: 'in_progress', priority: 'high' },
                { content: 'Run regression tests', status: 'pending', priority: 'medium' },
            ],
        }, context);

        const result = await new TodoReadTool().execute({ toolCallId: 'read-1' }, context);

        expect(result.success).toBe(true);
        const payload = JSON.parse(result.output) as {
            sessionId?: string;
            todos: Array<{ content: string; status: string; priority: string }>;
        };
        expect(payload.sessionId).toBe('session-test');
        expect(payload.todos).toHaveLength(2);
        expect(payload.todos[1]).toMatchObject({
            content: 'Run regression tests',
            status: 'pending',
            priority: 'medium',
        });
    });

    it('returns empty todo payload when no todo file exists', async () => {
        const context = createContext();
        const result = await new TodoReadTool().execute({ toolCallId: 'read-empty' }, context);

        expect(result.success).toBe(true);
        const payload = JSON.parse(result.output) as { todos: unknown[] };
        expect(payload.todos).toEqual([]);
        expect(result.metadata).toMatchObject({ exists: false, todoCount: 0 });
    });

    it('returns deterministic fallback selection for question tool', async () => {
        const context = createContext();
        const result = await new QuestionTool().execute({
            toolCallId: '1',
            question: 'Which mode should we use?',
            options: [
                { label: 'Parity first', description: 'Keep default surface minimal' },
                { label: 'Feature first', description: 'Expose all commands now' },
            ],
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('自动选择: Parity first');
        expect(result.metadata).toMatchObject({
            selected: ['Parity first'],
            interactive: false,
        });
    });

    it('uses requestQuestion callback when interactive channel exists', async () => {
        const context = createContext();
        const result = await new QuestionTool().execute({
            toolCallId: 'q1',
            header: 'Need your choice',
            question: 'Which mode should we use?',
            options: [
                { label: 'Parity first' },
                { label: 'Feature first' },
            ],
            multiple: false,
        }, {
            ...context,
            requestQuestion: async (prompt) => ({
                requestId: prompt.requestId,
                selected: ['Feature first'],
            }),
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('用户选择: Feature first');
        expect(result.metadata).toMatchObject({
            selected: ['Feature first'],
            interactive: true,
        });
    });
});
