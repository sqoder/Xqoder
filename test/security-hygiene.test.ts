import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';

describe('security hygiene script', () => {
    it('scans retained documentation files for secrets', () => {
        const script = fs.readFileSync(path.resolve('scripts/security-tracked-files.mjs'), 'utf-8');

        expect(script).toContain("'docs'");
        expect(script).not.toContain("'README.md'");
        expect(script).not.toContain("'ARCHITECTURE.md'");
    });
});
