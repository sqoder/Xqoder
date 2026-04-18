import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');
const publicDocs = [
    'README.md',
    'ARCHITECTURE.md',
];

const ABSOLUTE_PATH_PATTERNS = [
    /\/Users\/[^/\s]+\/[^\n`]+/g,
    /[A-Z]:\\\\Users\\\\[^\s`]+/g,
];

describe('public docs portability', () => {
    it('avoids machine-specific absolute paths in public-facing docs', () => {
        const offenders = publicDocs.flatMap((relativePath) => {
            const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
            const matches = ABSOLUTE_PATH_PATTERNS.flatMap((pattern) => content.match(pattern) ?? []);
            return matches.map((match) => `${relativePath}: ${match}`);
        });

        expect(offenders.join('\n')).toBe('');
    });
});
