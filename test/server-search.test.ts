import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { encodeSymbolCursor } from '../src/interfaces/http/server-helpers.js';
import {
    findProjectFilesByPath,
    findProjectSymbols,
    searchProjectContent,
} from '../src/interfaces/http/server-search.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('HTTP search helpers', () => {
    it('finds project files by relative path substring and respects limit', () => {
        const root = createTempProject();
        writeProjectFile(root, 'src/alpha-task.ts', 'export function alphaTask() {}\n');
        writeProjectFile(root, 'docs/alpha-guide.md', '# alpha\n');
        writeProjectFile(root, 'src/beta.ts', 'export const beta = 1;\n');

        const files = findProjectFilesByPath(root, 'alpha', 1);

        expect(files).toEqual(['docs/alpha-guide.md']);
    });

    it('searches project content with optional regex matching', () => {
        const root = createTempProject();
        writeProjectFile(root, 'src/alpha.ts', 'const alphaToken = 1;\nconst betaToken = 2;\n');
        writeProjectFile(root, 'src/beta.ts', 'const alphaValue = 3;\n');

        const matches = searchProjectContent(root, 'alpha\\w+', {
            regex: true,
            limit: 2,
        });

        expect(matches).toEqual([
            {
                path: 'src/alpha.ts',
                line: 1,
                text: 'const alphaToken = 1;',
            },
            {
                path: 'src/beta.ts',
                line: 1,
                text: 'const alphaValue = 3;',
            },
        ]);
    });

    it('finds project symbols through scan fallback with pagination', async () => {
        const root = createTempProject();
        writeProjectFile(root, 'src/alpha.ts', [
            'export function alphaTask() {',
            '  return true;',
            '}',
            'export const alphaValue = 1;',
        ].join('\n'));
        writeProjectFile(root, 'src/beta.ts', 'export class AlphaRunner {}\n');

        const firstPage = await findProjectSymbols({
            projectRoot: root,
            rawQuery: 'alpha',
            limit: 2,
        });

        expect(firstPage.ok).toBe(true);
        if (!firstPage.ok) {
            throw new Error('expected firstPage to be ok');
        }
        expect(firstPage.body.pagination.total).toBe(3);
        expect(firstPage.body.pagination.nextCursor).toBeString();
        expect(firstPage.body.symbols.map((symbol) => symbol.name)).toEqual([
            'alphaTask',
            'alphaValue',
        ]);
        expect(firstPage.body.strategy).toEqual({
            lspAttempted: false,
            lspSucceeded: false,
            fallbackScan: true,
        });

        const secondPage = await findProjectSymbols({
            projectRoot: root,
            rawQuery: 'alpha',
            limit: 2,
            rawCursor: firstPage.body.pagination.nextCursor,
        });

        expect(secondPage.ok).toBe(true);
        if (!secondPage.ok) {
            throw new Error('expected secondPage to be ok');
        }
        expect(secondPage.body.symbols.map((symbol) => symbol.name)).toEqual(['AlphaRunner']);
        expect(secondPage.body.pagination.nextCursor).toBeUndefined();
    });

    it('rejects symbol cursors that do not match the active query', async () => {
        const root = createTempProject();
        writeProjectFile(root, 'src/alpha.ts', 'export function alphaTask() {}\n');

        const result = await findProjectSymbols({
            projectRoot: root,
            rawQuery: 'alpha',
            rawCursor: encodeSymbolCursor({
                query: 'beta',
                offset: 1,
            }),
        });

        expect(result).toEqual({
            ok: false,
            status: 400,
            body: {
                error: 'Cursor does not match query/kind',
            },
        });
    });
});

function createTempProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-server-search-'));
    tempDirs.push(dir);
    return dir;
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
}
