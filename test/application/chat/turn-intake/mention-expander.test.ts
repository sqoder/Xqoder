import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { expandMentions } from '../../../../src/application/chat/turn-intake/mention-expander.js';

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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mention-expander-'));
    tempDirs.push(dir);
    return dir;
}

describe('expandMentions', () => {
    it('attaches files referenced with @path/to/file.ext', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'README.md'), '# readme');
        const result = expandMentions('please explain @README.md in one line', cwd);
        expect(result.attachments.length).toBe(1);
        expect(result.attachments[0]!.fileName).toBe('README.md');
    });

    it('handles multiple mentions including nested paths', () => {
        const cwd = createTempDir();
        const sub = path.join(cwd, 'src');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'index.ts'), 'export {};');
        fs.writeFileSync(path.join(cwd, 'README.md'), '# readme');

        const result = expandMentions('check @src/index.ts vs @README.md please', cwd);
        expect(result.attachments.map((a) => a.fileName).sort()).toEqual(['README.md', 'index.ts']);
    });

    it('ignores non-existent files silently', () => {
        const cwd = createTempDir();
        const result = expandMentions('look at @does-not-exist.md', cwd);
        expect(result.attachments.length).toBe(0);
        expect(result.missing).toEqual(['does-not-exist.md']);
    });

    it('does not expand email-style @user@example.com', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'example.com'), 'no extension-style file');
        const result = expandMentions('ping user@example.com for help', cwd);
        expect(result.attachments.length).toBe(0);
    });

    it('deduplicates when the same file is referenced twice', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'a.md'), 'a');
        const result = expandMentions('look at @a.md and also @a.md', cwd);
        expect(result.attachments.length).toBe(1);
    });

    it('respects XQODER_DISABLE_MENTION_EXPANSION=1 by returning no attachments', () => {
        const prev = process.env.XQODER_DISABLE_MENTION_EXPANSION;
        process.env.XQODER_DISABLE_MENTION_EXPANSION = '1';
        try {
            const cwd = createTempDir();
            fs.writeFileSync(path.join(cwd, 'README.md'), '# readme');
            const result = expandMentions('please explain @README.md', cwd);
            expect(result.attachments.length).toBe(0);
        } finally {
            if (prev === undefined) {
                delete process.env.XQODER_DISABLE_MENTION_EXPANSION;
            } else {
                process.env.XQODER_DISABLE_MENTION_EXPANSION = prev;
            }
        }
    });

    it('caps the number of auto-attached mentions', () => {
        const cwd = createTempDir();
        const names: string[] = [];
        for (let i = 0; i < 10; i += 1) {
            const name = `file${i}.md`;
            fs.writeFileSync(path.join(cwd, name), 'x');
            names.push(name);
        }
        const mentions = names.map((n) => `@${n}`).join(' ');
        const result = expandMentions(mentions, cwd);
        expect(result.attachments.length).toBeLessThanOrEqual(5);
    });
});
