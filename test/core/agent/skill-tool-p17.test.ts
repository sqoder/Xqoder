import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillTool } from '../../../src/core/agent/tools/interaction-tools.js';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';

const tempDirs: string[] = [];
let savedHome: string | undefined;

beforeEach(() => {
    savedHome = process.env.HOME;
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-skill-tool-home-'));
    tempDirs.push(emptyHome);
    process.env.HOME = emptyHome;
});

afterEach(() => {
    if (savedHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = savedHome;
    }
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
});

function makeProject(): { root: string; context: ToolContext } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-skill-tool-p17-'));
    tempDirs.push(root);
    const context: ToolContext = { cwd: root, projectRoot: root };
    return { root, context };
}

function writeSkill(root: string, fileName: string, body: string): string {
    const dir = path.join(root, '.xqoder', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, body, 'utf-8');
    return filePath;
}

describe('SkillTool (P17 query + activate)', () => {
    it('retains legacy activate: loads a plain .md skill without frontmatter', async () => {
        const { root, context } = makeProject();
        writeSkill(root, 'legacy.md', '# Legacy\nBody.');
        const result = await new SkillTool().execute({ name: 'legacy' }, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain('Legacy');
    });

    it('activate: returns activated skill metadata when frontmatter present', async () => {
        const { root, context } = makeProject();
        writeSkill(root, 'brand-voice.md', `---
name: brand-voice
description: Writing in the company tone
tools:
  - read_file
  - edit_file
---

Be brand-consistent.`);

        const result = await new SkillTool().execute({ name: 'brand-voice' }, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain('Be brand-consistent');
        expect(result.metadata?.activatedSkill).toBe('brand-voice');
        expect(result.metadata?.allowedTools).toEqual(['read_file', 'edit_file']);
    });

    it('list: returns registry summary with name + description', async () => {
        const { root, context } = makeProject();
        writeSkill(root, 'brand-voice.md', `---
name: brand-voice
description: Writing in the company tone
---
body.`);
        writeSkill(root, 'make-pdf.md', `---
name: make-pdf
description: Generate PDF
---
body.`);

        const result = await new SkillTool().execute({ action: 'list' }, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain('brand-voice');
        expect(result.output).toContain('Writing in the company tone');
        expect(result.output).toContain('make-pdf');
        expect(result.metadata?.skillCount).toBe(2);
    });

    it('list: ranks candidates when a prompt is supplied', async () => {
        const { root, context } = makeProject();
        writeSkill(root, 'brand-voice.md', `---
name: brand-voice
description: Writing in the company tone
triggers: [brand, tone]
---
body.`);
        writeSkill(root, 'make-pdf.md', `---
name: make-pdf
description: Generate PDF
triggers: [pdf, export]
---
body.`);

        const result = await new SkillTool().execute({ action: 'list', prompt: 'export a pdf' }, context);
        expect(result.success).toBe(true);
        expect(result.output).toContain('make-pdf');
        expect(result.metadata?.ranked).toBe(true);
    });

    it('activate: fails cleanly when skill does not exist', async () => {
        const { context } = makeProject();
        const result = await new SkillTool().execute({ name: 'ghost' }, context);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});
