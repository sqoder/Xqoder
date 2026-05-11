import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSkillsDir } from '../../../src/core/skills/load-dir.js';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir: string, fileName: string, body: string): string {
    const filePath = path.join(dir, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body, 'utf-8');
    return filePath;
}

describe('loadSkillsDir', () => {
    it('loads flat .md skills with frontmatter', () => {
        const dir = makeTempDir('xq-skills-flat-');
        writeSkill(dir, 'brand-voice.md', `---
name: brand-voice
description: Writing in the company tone
triggers: [brand, tone]
tools:
  - read_file
---

Brand voice body.`);
        writeSkill(dir, 'make-pdf.md', `---
name: make-pdf
description: Generate publication-quality PDF
triggers:
  - pdf
  - publish
---

PDF body.`);

        const skills = loadSkillsDir(dir);
        expect(skills.map((s) => s.name).sort()).toEqual(['brand-voice', 'make-pdf']);
        const brand = skills.find((s) => s.name === 'brand-voice')!;
        expect(brand.description).toBe('Writing in the company tone');
        expect(brand.triggers).toEqual(['brand', 'tone']);
        expect(brand.tools).toEqual(['read_file']);
        expect(brand.body.trim()).toBe('Brand voice body.');
    });

    it('loads SKILL.md under a subdirectory and uses dir name when frontmatter name is absent', () => {
        const dir = makeTempDir('xq-skills-dir-');
        writeSkill(dir, 'qa/SKILL.md', `---
description: Systematically QA test a web application
---

QA body.`);

        const skills = loadSkillsDir(dir);
        expect(skills).toHaveLength(1);
        expect(skills[0]!.name).toBe('qa');
        expect(skills[0]!.description).toBe('Systematically QA test a web application');
    });

    it('skips files without a description', () => {
        const dir = makeTempDir('xq-skills-bad-');
        writeSkill(dir, 'bad.md', `---
name: bad
---
no description.`);
        writeSkill(dir, 'good.md', `---
name: good
description: ok
---
body.`);

        const skills = loadSkillsDir(dir);
        expect(skills.map((s) => s.name)).toEqual(['good']);
    });

    it('returns empty array when directory is missing', () => {
        const skills = loadSkillsDir(path.join(os.tmpdir(), `xq-skills-missing-${Date.now()}`));
        expect(skills).toEqual([]);
    });

    it('deduplicates by name across roots (earlier root wins)', () => {
        const projectDir = makeTempDir('xq-skills-proj-');
        const userDir = makeTempDir('xq-skills-user-');
        writeSkill(projectDir, 'qa.md', `---
name: qa
description: Project-level QA
---
project.`);
        writeSkill(userDir, 'qa.md', `---
name: qa
description: User-level QA
---
user.`);

        const skills = loadSkillsDir([projectDir, userDir]);
        expect(skills).toHaveLength(1);
        expect(skills[0]!.description).toBe('Project-level QA');
        expect(skills[0]!.filePath).toContain(projectDir);
    });
});
