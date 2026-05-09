import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { EditFileTool, ReadFileTool } from '../../src/core/agent/tools/file-tools.js';
import { SandboxAccessError } from '../../src/core/agent/tools/sandbox.js';
import { ToolRegistry, type ToolApprovalRequest } from '../../src/core/agent/tools/tool.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('EditFileTool', () => {
    it('replaces a unique old_string and emits approval diff metadata', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'src', 'demo.ts');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'export const value = 1;\n', 'utf-8');
        const registry = new ToolRegistry();
        registry.register(new ReadFileTool());
        registry.register(new EditFileTool());
        let approvalRequest: ToolApprovalRequest | undefined;
        const context = {
            cwd,
            projectRoot: cwd,
            requestToolApproval: async (request: ToolApprovalRequest) => {
                approvalRequest = request;
                return true;
            },
        };

        await registry.execute('read_file', { path: 'src/demo.ts' }, context, 'read-before-edit-1');

        const result = await registry.execute(
            'edit_file',
            {
                file_path: 'src/demo.ts',
                old_string: 'value = 1',
                new_string: 'value = 2',
            },
            context,
            'edit-call-1',
        );

        expect(result.success).toBe(true);
        expect(fs.readFileSync(target, 'utf-8')).toBe('export const value = 2;\n');
        expect(approvalRequest).toMatchObject({
            toolName: 'edit_file',
            summary: expect.stringContaining('Edit file'),
            risk: 'medium',
        });
        expect(approvalRequest?.preview).toContain('-export const value = 1;');
        expect(approvalRequest?.preview).toContain('+export const value = 2;');
        expect(result.metadata).toMatchObject({
            path: target,
            changeType: 'write',
            editTool: 'edit_file',
            replacements: 1,
        });
    });

    it('rejects ambiguous replacements unless replace_all is true', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'demo.txt');
        fs.writeFileSync(target, 'same\nsame\n', 'utf-8');
        const tool = new EditFileTool();
        const reader = new ReadFileTool();
        const context = {
            cwd,
            projectRoot: cwd,
        };

        await reader.execute({ path: 'demo.txt', toolCallId: 'read-before-ambiguous' }, context);

        const ambiguous = await tool.execute({
            file_path: 'demo.txt',
            old_string: 'same',
            new_string: 'next',
            toolCallId: 'edit-call-ambiguous',
        }, context);
        expect(ambiguous.success).toBe(false);
        expect(ambiguous.error).toContain('matched 2 times');

        const replaceAll = await tool.execute({
            file_path: 'demo.txt',
            old_string: 'same',
            new_string: 'next',
            replace_all: true,
            toolCallId: 'edit-call-all',
        }, context);
        expect(replaceAll.success).toBe(true);
        expect(fs.readFileSync(target, 'utf-8')).toBe('next\nnext\n');
    });

    it('rejects empty, missing, and outside-project edits without writing', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'demo.txt');
        fs.writeFileSync(target, 'hello\n', 'utf-8');
        const tool = new EditFileTool();
        const reader = new ReadFileTool();
        const context = {
            cwd,
            projectRoot: cwd,
        };

        await expect(tool.execute({
            file_path: '../outside.txt',
            old_string: 'hello',
            new_string: 'bye',
            toolCallId: 'edit-call-outside',
        }, context)).rejects.toBeInstanceOf(SandboxAccessError);

        const empty = await tool.execute({
            file_path: 'demo.txt',
            old_string: '',
            new_string: 'bye',
            toolCallId: 'edit-call-empty',
        }, context);
        expect(empty.success).toBe(false);
        expect(empty.error).toContain('old_string cannot be empty');

        await reader.execute({ path: 'demo.txt', toolCallId: 'read-before-missing' }, context);
        const missing = await tool.execute({
            file_path: 'demo.txt',
            old_string: 'missing',
            new_string: 'bye',
            toolCallId: 'edit-call-missing',
        }, context);
        expect(missing.success).toBe(false);
        expect(missing.error).toContain('old_string was not found');
        expect(fs.readFileSync(target, 'utf-8')).toBe('hello\n');
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-edit-file-'));
    tempDirs.push(dir);
    return dir;
}
