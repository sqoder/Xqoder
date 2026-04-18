import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { TERMINAL_LOCAL_COMMANDS } from '../../../../src/platform/terminal/app/run-terminal-app.js';

const readmePath = path.resolve(import.meta.dir, '../../../../README.md');

function extractTuiSection(readme: string): string {
    const marker = '## TUI Shell';
    const start = readme.indexOf(marker);
    if (start === -1) {
        throw new Error('README missing "## TUI Shell" section');
    }

    const rest = readme.slice(start + marker.length);
    const nextHeadingIndex = rest.search(/\n##\s+/);
    return nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex);
}

describe('README TUI section', () => {
    it('documents only the live terminal shell commands', () => {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        const tuiSection = extractTuiSection(readme);

        Object.values(TERMINAL_LOCAL_COMMANDS).flat().forEach((command) => {
            expect(tuiSection).toContain(command);
        });

        expect(tuiSection).not.toContain('- `/sessions`');
        expect(tuiSection).not.toContain('- `/resume`');
        expect(tuiSection).not.toContain('- `/share`');
        expect(tuiSection).not.toContain('Ctrl+L');
        expect(tuiSection).not.toContain('Ctrl+Y');
    });
});
