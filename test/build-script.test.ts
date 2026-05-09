import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('build script assets', () => {
    it('copies the PDF.js worker beside the bundled CLI entrypoint', async () => {
        const rootDir = createTempDir();
        const distDir = path.join(rootDir, 'dist');
        const workerSource = path.join(rootDir, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
        fs.mkdirSync(path.dirname(workerSource), { recursive: true });
        fs.writeFileSync(workerSource, 'export default "pdf worker";\n', 'utf-8');

        const { copyPdfJsWorkerAsset } = await import('../scripts/build.mjs');

        const result = copyPdfJsWorkerAsset({ rootDir, distDir });

        expect(result).toEqual({
            sourcePath: workerSource,
            destPath: path.join(distDir, 'pdf.worker.mjs'),
        });
        expect(fs.readFileSync(path.join(distDir, 'pdf.worker.mjs'), 'utf-8')).toBe('export default "pdf worker";\n');
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-build-script-'));
    tempDirs.push(dir);
    return dir;
}
