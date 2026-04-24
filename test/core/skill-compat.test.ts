import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    DiscoverSkillsTool,
    SkillTool,
} from '../../src/core/agent/index.js';
import type { ToolContext } from '../../src/core/agent/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('skill compatibility', () => {
    it('loads and discovers Claude-compatible skills from .claude/skills', async () => {
        const projectRoot = createTempDir();
        const skillPath = path.join(projectRoot, '.claude', 'skills', 'verification-loop', 'SKILL.md');
        const flatSkillPath = path.join(projectRoot, '.claude', 'skills', 'flat-review.md');
        fs.mkdirSync(path.dirname(skillPath), { recursive: true });
        fs.writeFileSync(skillPath, '# Verification Loop\n\nRun targeted checks before finishing.\n', 'utf-8');
        fs.writeFileSync(flatSkillPath, '# Flat Review\n\nReview without changing code.\n', 'utf-8');

        const context: ToolContext = {
            cwd: projectRoot,
            projectRoot,
        };

        const skillResult = await new SkillTool().execute({ name: 'verification-loop' }, context);
        const flatSkillResult = await new SkillTool().execute({ name: 'flat-review' }, context);
        const discoveryResult = await new DiscoverSkillsTool().execute({}, context);

        expect(skillResult.success).toBe(true);
        expect(skillResult.output).toContain('Verification Loop');
        expect(flatSkillResult.success).toBe(true);
        expect(flatSkillResult.output).toContain('Flat Review');
        expect(discoveryResult.success).toBe(true);
        expect(discoveryResult.output).toContain('.claude/skills/verification-loop/SKILL.md');
        expect(discoveryResult.output).toContain('.claude/skills/flat-review.md');
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-skill-compat-'));
    tempDirs.push(dir);
    return dir;
}
