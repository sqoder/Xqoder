import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadOutputStylesDir } from '../../../src/core/output-styles/load-dir.js';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('loadOutputStylesDir', () => {
    it('loads styles with frontmatter body as systemPromptAppend fallback', () => {
        const dir = makeTempDir('xq-style-');
        fs.writeFileSync(path.join(dir, 'concise.md'), `---
name: concise
description: Short answers, no preamble
responseFormat: plain
---

Be terse. Skip pleasantries. Output bullet points only.`);

        const styles = loadOutputStylesDir(dir);
        expect(styles).toHaveLength(1);
        const style = styles[0]!;
        expect(style.name).toBe('concise');
        expect(style.description).toBe('Short answers, no preamble');
        expect(style.responseFormat).toBe('plain');
        expect(style.systemPromptAppend).toContain('Be terse');
    });

    it('prefers explicit systemPromptAppend key over body', () => {
        const dir = makeTempDir('xq-style-explicit-');
        fs.writeFileSync(path.join(dir, 'verbose.md'), `---
name: verbose
description: Detailed explanations
systemPromptAppend: "Always narrate your steps."
---

Ignored body.`);
        const styles = loadOutputStylesDir(dir);
        expect(styles[0]!.systemPromptAppend).toBe('Always narrate your steps.');
    });

    it('rejects styles without description', () => {
        const dir = makeTempDir('xq-style-bad-');
        fs.writeFileSync(path.join(dir, 'bad.md'), `---
name: bad
---
body.`);
        fs.writeFileSync(path.join(dir, 'ok.md'), `---
name: ok
description: ok style
---
body.`);
        const styles = loadOutputStylesDir(dir);
        expect(styles.map((s) => s.name)).toEqual(['ok']);
    });

    it('ignores invalid responseFormat', () => {
        const dir = makeTempDir('xq-style-fmt-');
        fs.writeFileSync(path.join(dir, 's.md'), `---
name: s
description: s
responseFormat: yaml
---
body.`);
        const styles = loadOutputStylesDir(dir);
        expect(styles[0]!.responseFormat).toBeUndefined();
    });
});
