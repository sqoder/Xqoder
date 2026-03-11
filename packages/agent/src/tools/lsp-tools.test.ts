import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    LspCompletionTool,
    LspHoverTool,
    LspDefinitionTool,
    LspFileDiagnosticsTool,
    LspRenameSymbolTool,
    LspReferencesTool,
    LspWorkspaceSymbolsTool,
} from './lsp-tools.js';

const tempDirs: string[] = [];

function createToolContext(): {
    projectRoot: string;
    cwd: string;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-lsp-'));
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

describe('lsp tools', () => {
    it('finds workspace symbols in TS/JS files', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);

        const result = await new LspWorkspaceSymbolsTool().execute({
            query: 'greet',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('greetUser');
        expect(result.output).toContain('utils.ts');
    });

    it('reports TypeScript diagnostics for a file', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);

        const result = await new LspFileDiagnosticsTool().execute({
            path: 'src/index.ts',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('TS2322');
        expect(result.output).toContain('index.ts');
    });

    it('finds symbol definitions from a file position', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);
        const filePath = path.join(context.projectRoot, 'src', 'index.ts');
        const { line, character } = findPosition(
            filePath,
            "greetUser('Ada')",
            'greetUser',
        );

        const result = await new LspDefinitionTool().execute({
            path: 'src/index.ts',
            line,
            character,
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('utils.ts');
        expect(result.output).toContain('greetUser');
    });

    it('finds symbol references from a file position', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);
        const filePath = path.join(context.projectRoot, 'src', 'index.ts');
        const { line, character } = findPosition(
            filePath,
            "greetUser('Ada')",
            'greetUser',
        );

        const result = await new LspReferencesTool().execute({
            path: 'src/index.ts',
            line,
            character,
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('utils.ts');
        expect(result.output).toContain('index.ts');
        expect(result.output).toContain("greetUser('Lin')");
    });

    it('returns hover information from a file position', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);
        const filePath = path.join(context.projectRoot, 'src', 'index.ts');
        const { line, character } = findPosition(
            filePath,
            "greetUser('Ada')",
            'greetUser',
        );

        const result = await new LspHoverTool().execute({
            path: 'src/index.ts',
            line,
            character,
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('greetUser');
        expect(result.output).toContain('range=');
    });

    it('returns completion candidates from a file position', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);
        const filePath = path.join(context.projectRoot, 'src', 'completion.ts');
        const { line, character } = findPosition(
            filePath,
            'gre',
            'gre',
        );

        const result = await new LspCompletionTool().execute({
            path: 'src/completion.ts',
            line,
            character: character + 3,
            resolveDetails: true,
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('greetUser');
        expect(result.output).toContain('[resolved]');
    });

    it('renames a symbol through the TypeScript language service', async () => {
        const context = createToolContext();
        seedTypeScriptProject(context.projectRoot);
        const filePath = path.join(context.projectRoot, 'src', 'index.ts');
        const { line, character } = findPosition(
            filePath,
            "greetUser('Ada')",
            'greetUser',
        );

        const result = await new LspRenameSymbolTool().execute({
            path: 'src/index.ts',
            line,
            character,
            newName: 'welcomeUser',
            toolCallId: '1',
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain('welcomeUser');
        expect(fs.readFileSync(path.join(context.projectRoot, 'src', 'utils.ts'), 'utf-8')).toContain('welcomeUser');
        expect(fs.readFileSync(path.join(context.projectRoot, 'src', 'index.ts'), 'utf-8')).toContain("welcomeUser('Ada')");
    });
});

function seedTypeScriptProject(projectRoot: string): void {
    const srcDir = path.join(projectRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            allowJs: true,
            checkJs: true,
            noEmit: true,
        },
        include: ['src/**/*'],
    }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'utils.ts'), [
        'export function greetUser(name: string): string {',
        '  return `Hello ${name}`;',
        '}',
        '',
    ].join('\n'), 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'index.ts'), [
        "import { greetUser } from './utils';",
        '',
        "const broken: string = 42;",
        "console.log(greetUser('Ada'));",
        "console.log(greetUser('Lin'));",
        '',
    ].join('\n'), 'utf-8');
    fs.writeFileSync(path.join(srcDir, 'completion.ts'), [
        "import { greetUser } from './utils';",
        '',
        'gre',
        '',
    ].join('\n'), 'utf-8');
}

function findPosition(
    filePath: string,
    anchor: string,
    target: string,
): {
    line: number;
    character: number;
} {
    const content = fs.readFileSync(filePath, 'utf-8');
    const anchorIndex = content.indexOf(anchor);
    const targetIndex = content.indexOf(target, anchorIndex);

    if (targetIndex === -1) {
        throw new Error(`未找到目标位置: ${target}`);
    }

    const before = content.slice(0, targetIndex);
    const lines = before.split('\n');

    return {
        line: lines.length,
        character: (lines.at(-1)?.length ?? 0) + 1,
    };
}
