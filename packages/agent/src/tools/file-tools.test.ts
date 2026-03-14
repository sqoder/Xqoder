import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRollbackStore } from './rollback-store.js';
import { PreviewDiffTool, ReadFileTool, SearchCodeTool, WriteFileTool } from './file-tools.js';

const tempDirs: string[] = [];

function hasRipgrep(): boolean {
    const probe = spawnSync('rg', ['--version'], { encoding: 'utf-8' });
    return !probe.error && probe.status === 0;
}

function createToolContext(): {
    projectRoot: string;
    cwd: string;
    sandboxMode?: 'project' | 'paths' | 'full-access';
    allowedPaths?: string[];
    sessionId?: string;
    rollbackStore?: FileRollbackStore;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-agent-files-'));
    const rollbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-agent-rollbacks-'));
    tempDirs.push(projectRoot);
    tempDirs.push(rollbackDir);
    return {
        projectRoot,
        cwd: projectRoot,
        sessionId: 'session_demo',
        rollbackStore: new FileRollbackStore(rollbackDir),
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

describe('file tools sandbox', () => {
    it('rejects reading files outside the project root', async () => {
        const context = createToolContext();
        const outsideFile = path.join(os.tmpdir(), `xqoder-outside-read-${Date.now()}.txt`);
        fs.writeFileSync(outsideFile, 'secret', 'utf-8');

        await expect(
            new ReadFileTool().execute({ path: outsideFile, toolCallId: '1' }, context),
        ).rejects.toThrow(/路径超出当前 sandbox/);
        fs.rmSync(outsideFile, { force: true });
    });

    it('rejects writing files outside the project root', async () => {
        const context = createToolContext();
        const outsideFile = path.join(os.tmpdir(), `xqoder-outside-write-${Date.now()}.txt`);

        await expect(
            new WriteFileTool().execute({
                path: outsideFile,
                content: 'secret',
                toolCallId: '1',
            }, context),
        ).rejects.toThrow(/路径超出当前 sandbox/);
    });

    it('searches code inside the project root with rg', async () => {
        if (!hasRipgrep()) {
            return;
        }

        const context = createToolContext();
        fs.writeFileSync(path.join(context.projectRoot, 'index.js'), "console.log('hello sandbox');\n");

        const result = await new SearchCodeTool().execute({
            pattern: 'hello sandbox',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('index.js');
    });

    it('allows writing files outside the project root in full-access mode', async () => {
        const context = {
            ...createToolContext(),
            sandboxMode: 'full-access' as const,
        };
        const outsideFile = path.join(os.tmpdir(), `xqoder-full-access-write-${Date.now()}.txt`);

        const result = await new WriteFileTool().execute({
            path: outsideFile,
            content: 'secret',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('secret');
        fs.rmSync(outsideFile, { force: true });
    });

    it('creates rollback metadata when writing a file', async () => {
        const context = createToolContext();
        const result = await new WriteFileTool().execute({
            path: 'README.md',
            content: '# Demo',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.metadata).toMatchObject({
            path: path.join(context.projectRoot, 'README.md'),
            changeType: 'write',
            rollbackPointId: expect.any(String),
        });
    });

    it('previews a unified diff without writing the file', async () => {
        const context = createToolContext();
        const filePath = path.join(context.projectRoot, 'README.md');
        fs.writeFileSync(filePath, '# Old\n', 'utf-8');

        const result = await new PreviewDiffTool().execute({
            path: 'README.md',
            content: '# New\n',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('---');
        expect(result.output).toContain('+++');
        expect(result.output).toContain('+# New');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Old\n');
    });
});

describe('write_file approval and paths (Day 9)', () => {
    it('buildApprovalRequest for new file returns request with summary 新建文件', () => {
        const context = createToolContext();
        const req = new WriteFileTool().buildApprovalRequest(
            { path: 'src/new.txt', content: 'hello' },
            context,
        );
        expect(req.summary).toMatch(/新建文件/);
        expect(req.risk).toBeDefined();
        expect(req.preview).toBeDefined();
    });

    it('buildApprovalRequest for existing file returns request with summary 覆盖文件', () => {
        const context = createToolContext();
        const p = path.join(context.projectRoot, 'existing.js');
        fs.writeFileSync(p, 'old', 'utf-8');
        const req = new WriteFileTool().buildApprovalRequest(
            { path: 'existing.js', content: 'new' },
            context,
        );
        expect(req.summary).toMatch(/覆盖文件/);
        expect(req.risk).toBeDefined();
        expect(req.preview).toContain('old');
        expect(req.preview).toContain('new');
    });

    it('write_file creates nested directories and writes content', async () => {
        const context = createToolContext();
        const result = await new WriteFileTool().execute({
            path: 'a/b/c/d.txt',
            content: 'nested',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        const fullPath = path.join(context.projectRoot, 'a/b/c/d.txt');
        expect(fs.existsSync(fullPath)).toBe(true);
        expect(fs.readFileSync(fullPath, 'utf-8')).toBe('nested');
    });

    it('high-risk path gets risk high in buildApprovalRequest', () => {
        const context = createToolContext();
        const req = new WriteFileTool().buildApprovalRequest(
            { path: '.env', content: 'KEY=value' },
            context,
        );
        expect(req.risk).toBe('high');
        expect(req.reason).toMatch(/高风险/);
    });

    it('new file in normal path still requires approval with risk medium (Day 30 新文件不默认放行)', () => {
        const context = createToolContext();
        const req = new WriteFileTool().buildApprovalRequest(
            { path: 'src/foo.js', content: 'console.log(1);' },
            context,
        );
        expect(req).toBeDefined();
        expect(req.summary).toMatch(/新建文件/);
        expect(req.risk).toBe('medium');
        expect(req.preview).toBeDefined();
    });
});
