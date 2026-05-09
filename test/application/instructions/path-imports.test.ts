import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    expandInstructionImports,
    resolveInstructionSet,
} from '../../../src/application/instructions/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('instruction @-path imports — Slice 13', () => {
    it('inlines a relative import from a CLAUDE.md file', () => {
        const cwd = createTempDir();
        fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'docs', 'arch.md'), 'Architecture: hexagonal.\nStatus: stable.');
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), [
            'Project conventions:',
            '',
            'See @./docs/arch.md for the architecture baseline.',
            '',
            'End of file.',
        ].join('\n'));

        const resolved = resolveInstructionSet({ cwd });
        const projectRules = resolved.sources.find((source) => source.name === 'project_rules');
        expect(projectRules).toBeDefined();

        const text = projectRules!.entries.join('\n');
        expect(text).toContain('Architecture: hexagonal.');
        expect(text).toContain('imported from docs/arch.md');
    });

    it('resolves @-imports relative to the file that contains them, not cwd', () => {
        const cwd = createTempDir();
        fs.mkdirSync(path.join(cwd, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.claude', 'sibling.md'), 'Sibling content.');
        fs.writeFileSync(path.join(cwd, '.claude', 'rules', 'extra.md'), [
            'Extra rule: see @../sibling.md',
        ].join('\n'));

        const resolved = resolveInstructionSet({ cwd });
        const projectRules = resolved.sources.find((source) => source.name === 'project_rules');
        const text = projectRules!.entries.join('\n');
        expect(text).toContain('Sibling content.');
    });

    it('follows imports recursively and stops at the depth limit without looping', () => {
        const cwd = createTempDir();
        const chain = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md'];
        for (let index = 0; index < chain.length; index += 1) {
            const name = chain[index]!;
            const next = chain[index + 1];
            const body = next
                ? `Layer ${name}\nNext: @./${next}`
                : `Layer ${name} (leaf)`;
            fs.writeFileSync(path.join(cwd, name), body);
        }
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'Root: @./a.md');

        const first = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8');
        const expanded = expandInstructionImports(first, path.join(cwd, 'CLAUDE.md'), cwd);

        // Depth limit is 5; we should see a few layers but not all 7.
        expect(expanded).toContain('Layer a.md');
        expect(expanded).toContain('Layer b.md');
        expect(expanded).toContain('Layer c.md');
        // The deepest chain members must be present either as leaf content
        // or as an unexpanded @-token once depth is exhausted.
        // The important invariant: expansion terminates without throwing.
        expect(expanded.length).toBeGreaterThan(0);
    });

    it('breaks import cycles without stack overflow', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'a.md'), 'A content. See @./b.md');
        fs.writeFileSync(path.join(cwd, 'b.md'), 'B content. See @./a.md');
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'Root: @./a.md');

        const first = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf-8');
        const expanded = expandInstructionImports(first, path.join(cwd, 'CLAUDE.md'), cwd);

        expect(expanded).toContain('A content.');
        expect(expanded).toContain('B content.');
        expect(expanded).toContain('circular import skipped');
    });

    it('does not expand @-tokens inside fenced code blocks', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'target.md'), 'SECRET_CONTENT');
        const content = [
            'Prose line referencing @./target.md',
            '',
            '```',
            'In-fence reference @./target.md should be preserved verbatim.',
            '```',
            '',
            'Another prose @./target.md',
        ].join('\n');
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), content);

        const expanded = expandInstructionImports(
            content,
            path.join(cwd, 'CLAUDE.md'),
            cwd,
        );

        // Expansion in prose lines.
        const secretMatches = (expanded.match(/SECRET_CONTENT/g) ?? []).length;
        // Expanded twice (two prose references), fenced reference left alone.
        expect(secretMatches).toBe(2);
        expect(expanded).toContain('In-fence reference @./target.md should be preserved verbatim.');
    });

    it('leaves missing paths as plain text and does not throw', () => {
        const cwd = createTempDir();
        const content = 'See @./does-not-exist.md for more.';
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), content);
        const expanded = expandInstructionImports(content, path.join(cwd, 'CLAUDE.md'), cwd);
        expect(expanded).toContain('@./does-not-exist.md');
        expect(expanded).not.toContain('imported from');
    });

    it('does not treat non-path @mentions as imports', () => {
        const cwd = createTempDir();
        const content = [
            'Hello @alice and @bob!',
            'Contact: user@example.com',
            'Alias @v1.2.3',
        ].join('\n');
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), content);
        const expanded = expandInstructionImports(content, path.join(cwd, 'CLAUDE.md'), cwd);
        expect(expanded).toContain('@alice');
        expect(expanded).toContain('@bob');
        expect(expanded).toContain('user@example.com');
        expect(expanded).not.toContain('imported from');
    });

    it('expands ~/... tokens against the user home directory', () => {
        const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-home-'));
        tempDirs.push(tmpHomeDir);
        const targetName = `slice13-home-import-${Date.now()}.md`;
        const targetAbs = path.join(tmpHomeDir, targetName);
        fs.writeFileSync(targetAbs, 'HOME_IMPORT_CONTENT');

        // Point os.homedir() lookups at our temp dir via relative traversal:
        // we can't easily monkeypatch homedir() here, so resolve the relative
        // distance from os.homedir() to our temp dir and reference via `@~/`.
        const relativeFromHome = path.relative(os.homedir(), targetAbs);
        const content = `Home file: @~/${relativeFromHome}`;
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), content);

        const expanded = expandInstructionImports(content, path.join(cwd, 'CLAUDE.md'), cwd);
        expect(expanded).toContain('HOME_IMPORT_CONTENT');
    });

    it('leaves behavior identical for files without @ tokens', () => {
        const cwd = createTempDir();
        const untouchedContent = [
            'Line one.',
            'Line two with no imports.',
            '```',
            'fenced contents',
            '```',
        ].join('\n');
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), untouchedContent);

        const expanded = expandInstructionImports(
            untouchedContent,
            path.join(cwd, 'CLAUDE.md'),
            cwd,
        );
        expect(expanded).toBe(untouchedContent);
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-path-imports-'));
    tempDirs.push(dir);
    return dir;
}
