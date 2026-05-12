import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ReadFileTool, SearchCodeTool, WriteFileTool } from '../../src/core/agent/tools/file-tools.js';
import type { ToolContext } from '../../src/core/agent/tools/tool.js';

const SAMPLE_DOCX_BASE64 = 'UEsDBBQAAAAIAHhrmVzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAeGuZXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAeGuZXHcLW/q1AAAAPwEAABEAAAB3b3JkL2RvY3VtZW50LnhtbJWPQQrCMBBF954iZG9TXYiUNkUXegE9QGxGW0hmQhKtvb1JxZ0Ibh7/M58/M3X7tIY9wIeBsOGrouQMsCM94K3h59NhueUsRIVaGUJo+ASBt3JRj5Wm7m4BI0sNGKqx4X2MrhIidD1YFQpygGl2JW9VTNbfxEheO08dhJAWWCPWZbkRVg3I5YKx1HohPWU5GycTfEaUO+N6xcyAUIvsM/1M9zW/h/hP/Kis/ZHP4n1aVp/X5QtQSwECFAMUAAAACAB4a5lc13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAHhrmVwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAHhrmVx3C1v6tQAAAD8BAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADhAgAAAAA=';

const INVALID_DOCX_BASE64 = 'bm90LWEtemlw';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('file tool deep mechanics', () => {
    it('rejects full reads above the default limit and allows bounded line ranges', async () => {
        const cwd = createTempDir();
        const filePath = path.join(cwd, 'large.html');
        fs.writeFileSync(filePath, `${'x'.repeat(270_000)}\nsecond line\nthird line\n`, 'utf-8');
        const context = createToolContext(cwd);
        const tool = new ReadFileTool();

        const fullRead = await tool.execute({
            path: 'large.html',
            toolCallId: 'read-large-full',
        }, context);
        expect(fullRead.success).toBe(false);
        expect(fullRead.error).toContain('File is too large to read fully');
        expect(fullRead.error).toContain('startLine/endLine');

        const rangedRead = await tool.execute({
            path: 'large.html',
            startLine: 2,
            endLine: 3,
            toolCallId: 'read-large-range',
        }, context);
        expect(rangedRead.success).toBe(true);
        expect(rangedRead.output).toBe('second line\nthird line');
        expect(rangedRead.metadata?.['readFileState']).toMatchObject({
            path: filePath,
            fullFile: false,
            startLine: 2,
            endLine: 3,
        });
    });

    it('rejects medium-sized HTML full reads before they flood the model context', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'prototype.html'), 'x'.repeat(90_000), 'utf-8');

        const result = await new ReadFileTool().execute({
            path: 'prototype.html',
            toolCallId: 'read-medium-html-full',
        }, createToolContext(cwd));

        expect(result.success).toBe(false);
        expect(result.error).toContain('File is too large to read fully');
        expect(result.error).toContain('startLine/endLine');
        expect(result.error).toContain('search_code');
        expect(result.error).toContain('"startLine":1');
        expect(result.error).toContain('"endLine":220');
        expect(result.error).toContain('Do not search generic phrases');
        expect(result.error).toContain('Title/meta-only or single tag-only matches are not enough');
        expect(result.error).toContain('single tag-only matches are not enough');
        expect(result.error).toContain('<body|<script|function|id=|class=|screen|tab|modal');
        expect(result.error).not.toContain('<title');
        expect(result.metadata).toMatchObject({
            suggestedStartLine: 1,
            suggestedEndLine: 220,
        });
    });

    it('blocks read-only file tools from paths outside the project sandbox unless the path is explicitly allowed', async () => {
        const root = createTempDir();
        const projectRoot = path.join(root, 'project');
        const externalRoot = path.join(root, 'external');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(externalRoot, { recursive: true });
        const externalFile = path.join(externalRoot, 'notes.txt');
        fs.writeFileSync(externalFile, 'TODO: inspect this sibling file\n', 'utf-8');
        const blockedContext = createToolContext(projectRoot, { sandboxMode: 'project' });

        await expect(new ReadFileTool().execute({
            path: externalFile,
            toolCallId: 'read-outside-project',
        }, blockedContext)).rejects.toMatchObject({
            kind: 'sandbox_access_error',
        });

        await expect(new SearchCodeTool().execute({
            path: '../external',
            pattern: 'TODO',
            toolCallId: 'search-outside-project',
        }, blockedContext)).rejects.toMatchObject({
            kind: 'sandbox_access_error',
        });


        const allowedContext = createToolContext(projectRoot, {
            sandboxMode: 'project',
            allowedPaths: [externalRoot],
        });

        const allowedRead = await new ReadFileTool().execute({
            path: externalFile,
            toolCallId: 'read-allowed-path',
        }, allowedContext);
        expect(allowedRead.success).toBe(true);
        expect(allowedRead.output).toContain('TODO: inspect this sibling file');

        const allowedSearch = await new SearchCodeTool().execute({
            path: '../external',
            pattern: 'TODO',
            toolCallId: 'search-allowed-path',
        }, allowedContext);
        expect(allowedSearch.success).toBe(true);
        expect(allowedSearch.output).toContain('TODO');
    });

    it('requires a complete fresh read before modifying an existing file but not before creating a new file', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'demo.md');
        fs.writeFileSync(target, 'before\n', 'utf-8');
        const context = createToolContext(cwd);
        const readFile = new ReadFileTool();
        const writeFile = new WriteFileTool();

        const withoutRead = await writeFile.execute({
            path: 'demo.md',
            content: 'after\n',
            toolCallId: 'write-without-read',
        }, context);
        expect(withoutRead.success).toBe(false);
        expect(withoutRead.error).toContain('must be read fully');
        expect(fs.readFileSync(target, 'utf-8')).toBe('before\n');

        await readFile.execute({
            path: 'demo.md',
            startLine: 1,
            endLine: 1,
            toolCallId: 'partial-read',
        }, context);
        const afterPartialRead = await writeFile.execute({
            path: 'demo.md',
            content: 'after partial\n',
            toolCallId: 'write-after-partial',
        }, context);
        expect(afterPartialRead.success).toBe(false);
        expect(afterPartialRead.error).toContain('must be read fully');

        const fullRead = await readFile.execute({
            path: 'demo.md',
            toolCallId: 'full-read',
        }, context);
        expect(fullRead.success).toBe(true);
        const afterFullRead = await writeFile.execute({
            path: 'demo.md',
            content: 'after\n',
            toolCallId: 'write-after-full',
        }, context);
        expect(afterFullRead.success).toBe(true);
        expect(fs.readFileSync(target, 'utf-8')).toBe('after\n');

        const newFile = await writeFile.execute({
            path: 'new.md',
            content: 'created\n',
            toolCallId: 'write-new-file',
        }, context);
        expect(newFile.success).toBe(true);
        expect(fs.readFileSync(path.join(cwd, 'new.md'), 'utf-8')).toBe('created\n');
    });

    it('rejects writes when the file changed after the complete read', async () => {
        const cwd = createTempDir();
        const target = path.join(cwd, 'stale.txt');
        fs.writeFileSync(target, 'before\n', 'utf-8');
        const context = createToolContext(cwd);
        const readFile = new ReadFileTool();
        const writeFile = new WriteFileTool();

        const fullRead = await readFile.execute({
            path: 'stale.txt',
            toolCallId: 'read-stale',
        }, context);
        expect(fullRead.success).toBe(true);

        fs.writeFileSync(target, 'external change\n', 'utf-8');
        const staleWrite = await writeFile.execute({
            path: 'stale.txt',
            content: 'agent change\n',
            toolCallId: 'write-stale',
        }, context);

        expect(staleWrite.success).toBe(false);
        expect(staleWrite.error).toContain('changed since it was last read');
        expect(fs.readFileSync(target, 'utf-8')).toBe('external change\n');
    });

    it('rejects ranged reads that exceed the model-safe output limit', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'range.txt'), [
            'start',
            'y'.repeat(101_000),
            'end',
        ].join('\n'), 'utf-8');
        const result = await new ReadFileTool().execute({
            path: 'range.txt',
            startLine: 1,
            endLine: 3,
            toolCallId: 'range-too-large',
        }, createToolContext(cwd));

        expect(result.success).toBe(false);
        expect(result.error).toContain('Requested line range is too large');
    });

    it('read-before-write guard errors do not carry stopReason=permission_denied', async () => {
        // Bug 3: guard errors were halting the agent instead of feeding back to the model.
        // They must NOT set stopReason so the model can self-recover by reading first.
        const cwd = createTempDir();
        const target = path.join(cwd, 'guarded.ts');
        fs.writeFileSync(target, 'const x = 1;\n', 'utf-8');
        const context = createToolContext(cwd);
        const writeFile = new WriteFileTool();

        const result = await writeFile.execute({
            path: 'guarded.ts',
            content: 'const x = 2;\n',
            toolCallId: 'write-no-read',
        }, context);

        expect(result.success).toBe(false);
        expect(result.error).toContain('must be read fully');
        // Must NOT carry stopReason — that would halt the agent loop
        expect((result.metadata as Record<string, unknown> | undefined)?.['stopReason']).toBeUndefined();
    });

    it('extracts plain text from docx files on full reads', async () => {
        const cwd = createTempDir();
        writeDocxFixture(path.join(cwd, 'report.docx'));

        const result = await new ReadFileTool().execute({
            path: 'report.docx',
            toolCallId: 'read-docx-full',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toBe('Alpha line\nBeta line\nGamma line');
        expect(result.metadata).toMatchObject({
            sourceFormat: 'docx',
            extractedChars: result.output.length,
        });
        expect(result.metadata?.['readFileState']).toMatchObject({
            fullFile: true,
            path: path.join(cwd, 'report.docx'),
        });
    });

    it('applies line ranges to extracted docx text', async () => {
        const cwd = createTempDir();
        writeDocxFixture(path.join(cwd, 'report.docx'));

        const result = await new ReadFileTool().execute({
            path: 'report.docx',
            startLine: 2,
            endLine: 2,
            toolCallId: 'read-docx-range',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toBe('Beta line');
        expect(result.metadata).toMatchObject({
            sourceFormat: 'docx',
        });
        expect(result.metadata?.['readFileState']).toMatchObject({
            fullFile: false,
            startLine: 2,
            endLine: 2,
        });
    });

    it('returns a clear error for invalid docx files', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'broken.docx'), Buffer.from(INVALID_DOCX_BASE64, 'base64'));

        const result = await new ReadFileTool().execute({
            path: 'broken.docx',
            toolCallId: 'read-docx-broken',
        }, createToolContext(cwd));

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to extract DOCX text');
    });

    it('nudges generic single-file searches back toward ranged reads and structural patterns', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'prototype.html'), '<title>Next 3</title>\n<script>function start(){}</script>\n', 'utf-8');

        const result = await new SearchCodeTool().execute({
            path: 'prototype.html',
            pattern: 'project overview',
            toolCallId: 'search-generic-html',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toContain('No matching results found');
        expect(result.output).toContain('generic');
        expect(result.output).toContain('read_file');
        expect(result.output).toContain('startLine/endLine');
        expect(result.output).toContain('Title/meta-only or single tag-only matches are not enough');
        expect(result.output).toContain('single tag-only matches are not enough');
        expect(result.output).toContain('<body|<script|function|id=|class=|screen|tab|modal');
        expect(result.output).not.toContain('<title');
    });

    it('rejects all-content regex searches on directories before they flood rg output', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'README.md'), '# Demo\n');
        fs.writeFileSync(path.join(cwd, 'package.json'), '{"scripts":{"dev":"vite"}}\n');

        const result = await new SearchCodeTool().execute({
            path: cwd,
            pattern: '.*',
            toolCallId: 'search-directory-everything',
        }, createToolContext(cwd));

        expect(result.success).toBe(false);
        expect(result.error).toContain('too broad');
        expect(result.error).toContain('list_files');
        expect(result.metadata).toMatchObject({
            path: cwd,
            pathKind: 'directory',
            broadPattern: '.*',
        });
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-file-deep-'));
    tempDirs.push(dir);
    return dir;
}

function createToolContext(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        cwd,
        projectRoot: cwd,
        ...overrides,
    };
}

function writeDocxFixture(filePath: string): void {
    fs.writeFileSync(filePath, Buffer.from(SAMPLE_DOCX_BASE64, 'base64'));
}
