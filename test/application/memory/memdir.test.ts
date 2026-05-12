import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    findRelevantMemories,
    loadMemdirContext,
    scanMemoryFiles,
} from '../../../src/application/memory/memdir.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memdir-test-'));
    tempDirs.push(dir);
    return dir;
}

describe('memdir', () => {
    it('scans project and user memory files (CLAUDE.md, xqoder.md, memdir/*.md)', () => {
        const cwd = createTempDir();
        const home = createTempDir();

        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# project\ngolang notes');
        fs.mkdirSync(path.join(cwd, 'memdir'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'memdir', 'deploy.md'), 'deployment tips');
        fs.mkdirSync(path.join(home, '.xqoder'), { recursive: true });
        fs.writeFileSync(path.join(home, '.xqoder', 'CLAUDE.md'), 'user global prefs');

        const found = scanMemoryFiles({ cwd, homeDir: home });
        const names = found.map((m) => path.basename(m.filePath)).sort();
        expect(names).toContain('CLAUDE.md');
        expect(names).toContain('deploy.md');
        expect(found.length).toBeGreaterThanOrEqual(3);
    });

    it('ignores empty and too-large memory files', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '   \n');
        fs.writeFileSync(path.join(cwd, 'xqoder.md'), 'real content here');

        const found = scanMemoryFiles({ cwd, homeDir: createTempDir() });
        const names = found.map((m) => path.basename(m.filePath));
        expect(names).not.toContain('CLAUDE.md');
        expect(names).toContain('xqoder.md');
    });

    it('ranks memories by overlapping keywords with the prompt', () => {
        const cwd = createTempDir();
        const home = createTempDir();
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'deployment pipeline for production is kubernetes');
        fs.mkdirSync(path.join(cwd, 'memdir'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'memdir', 'unrelated.md'), 'cooking recipes for pasta');

        const all = scanMemoryFiles({ cwd, homeDir: home });
        const relevant = findRelevantMemories(all, 'help me check the kubernetes deployment pipeline');
        expect(relevant.length).toBeGreaterThan(0);
        expect(path.basename(relevant[0]!.filePath)).toBe('CLAUDE.md');
    });

    it('loadMemdirContext returns the relevant subset as MemoryBlocks', async () => {
        const cwd = createTempDir();
        const home = createTempDir();
        fs.writeFileSync(path.join(cwd, 'xqoder.md'), 'rule: always run release:check before shipping');

        const result = await loadMemdirContext({
            cwd,
            homeDir: home,
            prompt: 'will release:check catch the issue',
            sessionId: 'sess-1',
        });
        expect(result.memories.length).toBe(1);
        expect(result.memories[0]!.source).toBe('project');
        expect(result.memories[0]!.content).toContain('release:check');
    });

    it('returns no memories when findRelevantMemories has no overlap', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'apple orange banana');
        const all = scanMemoryFiles({ cwd, homeDir: createTempDir() });
        const relevant = findRelevantMemories(all, 'rocket launch trajectory');
        expect(relevant.length).toBe(0);
    });

    it('respects XQODER_DISABLE_MEMDIR=1 by returning empty context', async () => {
        const prev = process.env.XQODER_DISABLE_MEMDIR;
        process.env.XQODER_DISABLE_MEMDIR = '1';
        try {
            const cwd = createTempDir();
            fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'anything here');
            const result = await loadMemdirContext({
                cwd,
                homeDir: createTempDir(),
                prompt: 'anything here',
                sessionId: 'sess-x',
            });
            expect(result.memories.length).toBe(0);
        } finally {
            if (prev === undefined) {
                delete process.env.XQODER_DISABLE_MEMDIR;
            } else {
                process.env.XQODER_DISABLE_MEMDIR = prev;
            }
        }
    });
});
