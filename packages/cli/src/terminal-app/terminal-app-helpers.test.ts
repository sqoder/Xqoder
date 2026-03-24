import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    __resetCompleteFrecencyForTest,
    loadCompleteSearchEntries,
    recordCompleteSelection,
} from './terminal-app-helpers.js';

describe('terminal-app-helpers complete frecency', () => {
    const createdDirs: string[] = [];

    afterEach(() => {
        __resetCompleteFrecencyForTest();
        for (const dir of createdDirs.splice(0)) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // ignore cleanup failures in tests
            }
        }
    });

    it('prioritizes frequently selected entries when query is empty', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-complete-'));
        createdDirs.push(root);

        const alphaPath = path.join(root, 'alpha.ts');
        const betaPath = path.join(root, 'beta.ts');
        fs.writeFileSync(alphaPath, 'alpha');
        fs.writeFileSync(betaPath, 'beta');

        recordCompleteSelection(betaPath);
        recordCompleteSelection(betaPath);

        const results = loadCompleteSearchEntries(root, '');
        const firstFile = results.find((entry) => !entry.isDir && entry.label !== '..');
        expect(firstFile?.path).toBe(path.resolve(betaPath));
    });

    it('prioritizes frecency among same-query matches', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-complete-'));
        createdDirs.push(root);

        const srcDir = path.join(root, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        const readmePath = path.join(srcDir, 'readme.md');
        const routePath = path.join(srcDir, 'routes.md');
        fs.writeFileSync(readmePath, 'readme');
        fs.writeFileSync(routePath, 'routes');

        recordCompleteSelection(routePath);

        const results = loadCompleteSearchEntries(root, 'r');
        const firstFile = results.find((entry) => !entry.isDir);
        expect(firstFile?.path).toBe(path.resolve(routePath));
    });
});
