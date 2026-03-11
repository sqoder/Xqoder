import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_DIFF_PREVIEW_LENGTH = 4000;

export function createFileDiffPreview(
    filePath: string,
    beforeContent: string,
    afterContent: string,
): string {
    if (beforeContent === afterContent) {
        return `No changes for ${filePath}`;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-diff-'));
    const beforePath = path.join(tempDir, 'before.txt');
    const afterPath = path.join(tempDir, 'after.txt');

    try {
        fs.writeFileSync(beforePath, beforeContent, 'utf-8');
        fs.writeFileSync(afterPath, afterContent, 'utf-8');

        const result = spawnSync('git', [
            'diff',
            '--no-index',
            '--no-ext-diff',
            '--src-prefix=a/',
            '--dst-prefix=b/',
            '--',
            beforePath,
            afterPath,
        ], {
            encoding: 'utf-8',
        });
        const output = `${result.stdout || ''}${result.stderr || ''}`
            .replaceAll(beforePath, filePath)
            .replaceAll(afterPath, filePath);

        return truncatePreview(output || `Modified ${filePath}`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

export function truncatePreview(value: string): string {
    if (value.length <= MAX_DIFF_PREVIEW_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_DIFF_PREVIEW_LENGTH - 3)}...`;
}
