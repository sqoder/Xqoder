import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '../../..');
const tuiRoot = path.join(repoRoot, 'src/platform/tui');
const sourceRoot = path.join(repoRoot, 'src');

describe('legacy platform/tui surface', () => {
    it('has no remaining source files', () => {
        const actualFiles = collectRelativeFiles(tuiRoot);
        expect(actualFiles).toEqual([]);
    });

    it('is no longer referenced by source imports', () => {
        const sourceFiles = collectRelativeFiles(sourceRoot)
            .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
        const offenders = sourceFiles.filter((file) => {
            const content = fs.readFileSync(path.join(sourceRoot, file), 'utf-8');
            return content.includes('platform/tui');
        });

        expect(offenders).toEqual([]);
    });
});

function collectRelativeFiles(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }

    const files: string[] = [];

    const walk = (currentDir: string): void => {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const nextPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(nextPath);
                continue;
            }
            files.push(path.relative(root, nextPath));
        }
    };

    walk(root);
    return files.sort();
}
