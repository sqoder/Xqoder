import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    runInfoSkillsCommand,
    runListSkillsCommand,
} from '../../src/commands/core/skills.js';
import {
    runClearOutputStyleCommand,
    runListOutputStylesCommand,
    runShowOutputStyleCommand,
    runUseOutputStyleCommand,
} from '../../src/commands/core/output-style.js';

function makeProject(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-p17-cli-'));
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-p17-cli-home-'));
    process.env.HOME = emptyHome;
    return root;
}

function writeFile(root: string, relPath: string, body: string): void {
    const filePath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body, 'utf-8');
}

describe('xqoder skills CLI', () => {
    it('ls returns JSON list of skills', () => {
        const root = makeProject();
        writeFile(root, '.xqoder/skills/alpha.md', `---
name: alpha
description: Alpha skill
---
body.`);
        writeFile(root, '.xqoder/skills/beta.md', `---
name: beta
description: Beta skill
---
body.`);

        const captured: string[] = [];
        const entries = runListSkillsCommand({ json: true }, { cwd: root, writeOutput: (line) => captured.push(line) });
        expect(entries.map((e) => e.name)).toEqual(['alpha', 'beta']);
        expect(captured[0]).toContain('"alpha"');
    });

    it('info returns skill details', () => {
        const root = makeProject();
        writeFile(root, '.xqoder/skills/qa.md', `---
name: qa
description: Systematically QA test a web app
triggers:
  - qa
  - browser
tools:
  - read_file
  - run_shell
---
Body text.`);
        const info = runInfoSkillsCommand('qa', { json: true }, { cwd: root, writeOutput: () => {} });
        expect(info.name).toBe('qa');
        expect(info.triggers).toEqual(['qa', 'browser']);
        expect(info.tools).toEqual(['read_file', 'run_shell']);
    });

    it('info throws when skill is missing', () => {
        const root = makeProject();
        expect(() => runInfoSkillsCommand('ghost', {}, { cwd: root, writeOutput: () => {} })).toThrow(/Skill not found/);
    });
});

describe('xqoder output-style CLI', () => {
    it('ls marks active selection with `*`', () => {
        const root = makeProject();
        writeFile(root, '.xqoder/output-styles/concise.md', `---
name: concise
description: Short answers
---
Be terse.`);
        writeFile(root, '.xqoder/output-styles/verbose.md', `---
name: verbose
description: Detailed answers
---
Narrate everything.`);

        runUseOutputStyleCommand('concise', { cwd: root });

        const captured: string[] = [];
        runListOutputStylesCommand({}, { cwd: root, writeOutput: (line) => captured.push(line) });
        const conciseLine = captured.find((l) => l.includes('concise'));
        const verboseLine = captured.find((l) => l.includes('verbose'));
        expect(conciseLine).toMatch(/^\*/);
        expect(verboseLine).toMatch(/^ /);
    });

    it('use fails for unknown style', () => {
        const root = makeProject();
        expect(() => runUseOutputStyleCommand('ghost', { cwd: root })).toThrow(/not found/);
    });

    it('show + clear flow', () => {
        const root = makeProject();
        writeFile(root, '.xqoder/output-styles/concise.md', `---
name: concise
description: Short answers
---
Be terse.`);
        runUseOutputStyleCommand('concise', { cwd: root });
        expect(runShowOutputStyleCommand({ json: true }, { cwd: root, writeOutput: () => {} }).name).toBe('concise');
        runClearOutputStyleCommand({ cwd: root });
        expect(runShowOutputStyleCommand({ json: true }, { cwd: root, writeOutput: () => {} }).name).toBeNull();
    });
});
