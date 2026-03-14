import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobFilesTool, GrepContentTool, ListFilesTool } from './discovery-tools.js';

const tempDirs: string[] = [];

function hasRipgrep(): boolean {
    const probe = spawnSync('rg', ['--version'], { encoding: 'utf-8' });
    return !probe.error && probe.status === 0;
}

function createToolContext(): {
    projectRoot: string;
    cwd: string;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-discovery-'));
    tempDirs.push(projectRoot);
    return {
        projectRoot,
        cwd: projectRoot,
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

describe('discovery tools', () => {
    it('lists files as a tree', async () => {
        const context = createToolContext();
        fs.mkdirSync(path.join(context.projectRoot, 'src'), { recursive: true });
        fs.writeFileSync(path.join(context.projectRoot, 'src', 'index.ts'), 'export {};\n');

        const result = await new ListFilesTool().execute({
            path: '.',
            maxDepth: 2,
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('src/');
        expect(result.output).toContain('src/index.ts');
    });

    it('finds files with a glob pattern', async () => {
        if (!hasRipgrep()) {
            return;
        }

        const context = createToolContext();
        fs.mkdirSync(path.join(context.projectRoot, 'src'), { recursive: true });
        fs.writeFileSync(path.join(context.projectRoot, 'src', 'index.ts'), 'export {};\n');
        fs.writeFileSync(path.join(context.projectRoot, 'src', 'index.js'), 'module.exports = {};\n');

        const result = await new GlobFilesTool().execute({
            pattern: 'src/**/*.ts',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('src/index.ts');
        expect(result.output).not.toContain('src/index.js');
    });

    it('greps file content with an include glob', async () => {
        if (!hasRipgrep()) {
            return;
        }

        const context = createToolContext();
        fs.mkdirSync(path.join(context.projectRoot, 'src'), { recursive: true });
        fs.writeFileSync(path.join(context.projectRoot, 'src', 'index.ts'), "console.log('needle');\n");
        fs.writeFileSync(path.join(context.projectRoot, 'src', 'index.js'), "console.log('needle');\n");

        const result = await new GrepContentTool().execute({
            pattern: 'needle',
            include: '*.ts',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('index.ts');
        expect(result.output).not.toContain('index.js');
    });
});
