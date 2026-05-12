import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSkillRegistry, resolveSkillSearchRoots } from '../../../src/core/skills/registry.js';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('resolveSkillSearchRoots', () => {
    it('lists project roots before user roots', () => {
        const roots = resolveSkillSearchRoots('/tmp/project', { homeDir: '/home/u' });
        expect(roots).toEqual([
            '/tmp/project/.xqoder/skills',
            '/tmp/project/.claude/skills',
            '/tmp/project/skills',
            '/home/u/.xqoder/skills',
            '/home/u/.claude/skills',
        ]);
    });

    it('inserts extraRoots between project and user roots', () => {
        const roots = resolveSkillSearchRoots('/p', { homeDir: '/h', extraRoots: ['/x/extra'] });
        expect(roots).toContain('/x/extra');
        const extraIndex = roots.indexOf('/x/extra');
        const userIndex = roots.indexOf('/h/.xqoder/skills');
        expect(extraIndex).toBeLessThan(userIndex);
    });
});

describe('loadSkillRegistry', () => {
    it('loads skills from project .xqoder/skills and resolves by name', () => {
        const projectRoot = makeTempDir('xq-skills-reg-');
        const skillDir = path.join(projectRoot, '.xqoder', 'skills');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'alpha.md'), `---
name: alpha
description: alpha skill
---
body.`);
        fs.writeFileSync(path.join(skillDir, 'beta.md'), `---
name: beta
description: beta skill
---
body.`);

        const registry = loadSkillRegistry(projectRoot, { homeDir: path.join(projectRoot, 'home-empty') });
        expect(registry.skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
        expect(registry.get('alpha')!.description).toBe('alpha skill');
        expect(registry.get('missing')).toBeUndefined();
    });
});
