import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { registerDefaultAgentTools } from '../../src/core/agent/agent-default-tools.js';
import { ReadFileTool } from '../../src/core/agent/tools/file-tools.js';
import { ReadAnyFileTool } from '../../src/core/agent/tools/read-any-file/index.js';
import type { ToolContext } from '../../src/core/agent/tools/tool.js';
import { ToolRegistry } from '../../src/core/agent/tools/tool.js';

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('read_any_file tool', () => {
    it('is registered as a default read-only tool', () => {
        const cwd = createTempDir();
        const registry = new ToolRegistry();

        registerDefaultAgentTools({
            toolRegistry: registry,
            toolContext: createToolContext(cwd),
            llmConfig: {
                provider: 'openai',
                model: 'test-model',
                apiKey: 'test-key',
            },
        });

        expect(registry.getDefinitions().map((definition) => definition.name)).toContain('read_any_file');
    });

    it('analyzes text files with model-readable output and structured metadata', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'notes.md'), '# Title\nhello world\n', 'utf-8');

        const result = await new ReadAnyFileTool().execute({
            path: 'notes.md',
            toolCallId: 'read-any-text',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toContain('File Analysis');
        expect(result.output).toContain('kind: text');
        expect(result.output).toContain('# Title');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'text',
            fileName: 'notes.md',
        });
    });

    it('extracts PDF text with pdftotext and honors page ranges', async () => {
        const cwd = createTempDir();
        const binDir = path.join(cwd, 'bin');
        const argsPath = path.join(cwd, 'pdftotext-args.txt');
        fs.mkdirSync(binDir);
        writeExecutable(path.join(binDir, 'pdftotext'), [
            '#!/bin/sh',
            'printf "%s\\n" "$@" > "$XQODER_FAKE_ARGS"',
            'printf "Alpha PDF text\\nBeta PDF text\\n"',
        ].join('\n'));
        fs.writeFileSync(path.join(cwd, 'report.pdf'), '%PDF-1.4\n%%EOF\n', 'utf-8');

        const result = await new ReadAnyFileTool().execute({
            path: 'report.pdf',
            pages: '2-4',
            toolCallId: 'read-any-pdf',
        }, createToolContext(cwd, {
            env: {
                PATH: binDir,
                XQODER_FAKE_ARGS: argsPath,
            },
        }));

        expect(result.success).toBe(true);
        expect(result.output).toContain('kind: pdf');
        expect(result.output).toContain('Alpha PDF text');
        expect(fs.readFileSync(argsPath, 'utf-8')).toContain('-f\n2\n-l\n4');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'pdf',
            content: 'Alpha PDF text\nBeta PDF text',
        });
    });

    it('returns a clear warning when PDF text tools are unavailable', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'scan.pdf'), '%PDF-1.4\n%%EOF\n', 'utf-8');

        const result = await new ReadAnyFileTool().execute({
            path: 'scan.pdf',
            toolCallId: 'read-any-pdf-missing-tool',
        }, createToolContext(cwd, {
            env: { PATH: path.join(cwd, 'empty-bin') },
        }));

        expect(result.success).toBe(true);
        expect(result.output).toContain('kind: pdf');
        expect(result.output).toContain('pdftotext');
        expect(result.output).not.toContain('startLine/endLine');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'pdf',
            warnings: expect.arrayContaining([expect.stringContaining('pdftotext')]),
        });
    });

    it('uses the built-in PDF.js fallback when pdftotext is unavailable', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'fallback.pdf'), buildSimpleTextPdf('Alpha PDF.js fallback text'), 'binary');

        const result = await new ReadAnyFileTool().execute({
            path: 'fallback.pdf',
            toolCallId: 'read-any-pdf-js-fallback',
        }, createToolContext(cwd, {
            env: { PATH: path.join(cwd, 'empty-bin') },
        }));

        expect(result.success).toBe(true);
        expect(result.output).toContain('Alpha PDF.js fallback text');
        expect(result.output).toContain('Built-in PDF.js text extraction was used');
        expect(result.output).not.toContain('No PDF text content was extracted');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'pdf',
            content: expect.stringContaining('Alpha PDF.js fallback text'),
            warnings: expect.arrayContaining([expect.stringContaining('PDF.js')]),
        });
    });

    it('prepares a native PDF payload for small PDFs', async () => {
        const cwd = createTempDir();
        const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf-8');
        fs.writeFileSync(path.join(cwd, 'native.pdf'), pdfBytes);

        const result = await new ReadAnyFileTool().execute({
            path: 'native.pdf',
            toolCallId: 'read-any-pdf-native',
        }, createToolContext(cwd, {
            env: { PATH: path.join(cwd, 'empty-bin') },
        }));

        const analysis = result.metadata?.['analysis'] as {
            documents?: Array<{ mime: string; size: number; base64?: string }>;
        };

        expect(result.success).toBe(true);
        expect(result.output).toContain('Native Documents:');
        expect(result.attachments?.[0]).toMatchObject({
            type: 'file',
            mimeType: 'application/pdf',
            data: pdfBytes.toString('base64'),
            fileName: 'native.pdf',
        });
        expect(analysis.documents?.[0]).toMatchObject({
            mime: 'application/pdf',
            size: pdfBytes.length,
            base64: pdfBytes.toString('base64'),
        });
    });

    it('renders requested PDF pages through pdftoppm', async () => {
        const cwd = createTempDir();
        const binDir = path.join(cwd, 'bin');
        const argsPath = path.join(cwd, 'pdftoppm-args.txt');
        fs.mkdirSync(binDir);
        writeExecutable(path.join(binDir, 'pdftoppm'), [
            '#!/bin/sh',
            'printf "%s\\n" "$@" > "$XQODER_FAKE_ARGS"',
            'prefix=""',
            'for arg in "$@"; do prefix="$arg"; done',
            'printf "page-two" > "${prefix}-2.jpg"',
            'printf "page-three" > "${prefix}-3.jpg"',
        ].join('\n'));
        fs.writeFileSync(path.join(cwd, 'slides.pdf'), '%PDF-1.4\n%%EOF\n', 'utf-8');

        const result = await new ReadAnyFileTool().execute({
            path: 'slides.pdf',
            pages: '2-3',
            mode: 'render',
            toolCallId: 'read-any-pdf-render',
        }, createToolContext(cwd, {
            env: {
                PATH: binDir,
                XQODER_FAKE_ARGS: argsPath,
            },
        }));
        const analysis = result.metadata?.['analysis'] as {
            images?: Array<{ page?: number; mime: string; base64?: string }>;
        };

        expect(result.success).toBe(true);
        expect(result.output).toContain('Rendered Images:');
        expect(result.attachments).toEqual([
            expect.objectContaining({
                type: 'file',
                mimeType: 'application/pdf',
                fileName: 'slides.pdf',
            }),
            expect.objectContaining({
                type: 'image',
                mimeType: 'image/jpeg',
                data: Buffer.from('page-two').toString('base64'),
                fileName: 'page-2.jpg',
            }),
            expect.objectContaining({
                type: 'image',
                mimeType: 'image/jpeg',
                data: Buffer.from('page-three').toString('base64'),
                fileName: 'page-3.jpg',
            }),
        ]);
        expect(fs.readFileSync(argsPath, 'utf-8')).toContain('-f\n2\n-l\n3');
        expect(analysis.images).toEqual([
            expect.objectContaining({
                page: 2,
                mime: 'image/jpeg',
                base64: Buffer.from('page-two').toString('base64'),
            }),
            expect.objectContaining({
                page: 3,
                mime: 'image/jpeg',
                base64: Buffer.from('page-three').toString('base64'),
            }),
        ]);
    });

    it('reports PDF page count and asks for pages when a long PDF is not filtered', async () => {
        const cwd = createTempDir();
        const binDir = path.join(cwd, 'bin');
        fs.mkdirSync(binDir);
        writeExecutable(path.join(binDir, 'pdfinfo'), [
            '#!/bin/sh',
            'printf "Title: Demo\\nPages:          12\\n"',
        ].join('\n'));
        fs.writeFileSync(path.join(cwd, 'long.pdf'), '%PDF-1.4\n%%EOF\n', 'utf-8');

        const result = await new ReadAnyFileTool().execute({
            path: 'long.pdf',
            toolCallId: 'read-any-pdf-long',
        }, createToolContext(cwd, {
            env: { PATH: binDir },
        }));

        expect(result.success).toBe(true);
        expect(result.output).toContain('12 pages');
        expect(result.output).toContain('pages parameter');
        expect(result.output).not.toContain('startLine/endLine');
    });

    it('analyzes images without requiring optional OCR or EXIF tools', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'pixel.png'), Buffer.from(PNG_1X1_BASE64, 'base64'));

        const result = await new ReadAnyFileTool().execute({
            path: 'pixel.png',
            toolCallId: 'read-any-image',
        }, createToolContext(cwd, {
            env: { PATH: path.join(cwd, 'empty-bin') },
        }));

        expect(result.success).toBe(true);
        expect(result.output).toContain('kind: image');
        expect(result.output).toContain('SHA-256');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'image',
            mime: 'image/png',
        });
    });

    it('falls back to binary analysis for unknown formats', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'mystery.bin'), Buffer.from([0, 1, 2, 65, 66, 67, 255, 10, 68, 69, 70]));

        const result = await new ReadAnyFileTool().execute({
            path: 'mystery.bin',
            toolCallId: 'read-any-binary',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toContain('kind: binary');
        expect(result.output).toContain('SHA-256');
        expect(result.output).toContain('Hex preview');
        expect(result.metadata?.['analysis']).toMatchObject({
            ok: true,
            kind: 'binary',
            metadata: expect.objectContaining({
                sha256: expect.any(String),
            }),
        });
    });

    it('lets legacy read_file route non-text files through read_any_file', async () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'asset.bin'), Buffer.from([0, 1, 2, 65, 66, 67, 255]));

        const result = await new ReadFileTool().execute({
            path: 'asset.bin',
            toolCallId: 'legacy-read-binary',
        }, createToolContext(cwd));

        expect(result.success).toBe(true);
        expect(result.output).toContain('File Analysis');
        expect(result.output).toContain('kind: binary');
        expect(result.metadata?.['analysis']).toMatchObject({
            kind: 'binary',
        });
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-read-any-'));
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

function writeExecutable(filePath: string, content: string): void {
    fs.writeFileSync(filePath, `${content}\n`, 'utf-8');
    fs.chmodSync(filePath, 0o755);
}

function buildSimpleTextPdf(text: string): Buffer {
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfLiteral(text)}) Tj ET`;
    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
        '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
        offsets.push(Buffer.byteLength(pdf, 'binary'));
        pdf += object;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'binary');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (const offset of offsets.slice(1)) {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'binary');
}

function escapePdfLiteral(value: string): string {
    return value.replace(/([\\()])/g, '\\$1');
}
