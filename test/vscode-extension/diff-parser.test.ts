import { describe, expect, it } from 'bun:test';
import {
    applyDiffToContent,
    parseDiffPreview,
} from '../../apps/vscode-extension/src/review/diff-parser.js';

describe('VS Code diff parser — Slice 14', () => {
    it('parses a git-style unified diff and extracts the file path', () => {
        const preview = [
            'diff --git a/src/foo.ts b/src/foo.ts',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1,3 +1,4 @@',
            ' line-1',
            '-line-2',
            '+line-2-modified',
            '+line-2.5',
            ' line-3',
        ].join('\n');
        const parsed = parseDiffPreview(preview);
        expect(parsed).toBeDefined();
        expect(parsed?.filePath).toBe('src/foo.ts');
        expect(parsed?.isNewFile).toBe(false);
        expect(parsed?.hunks.length).toBe(1);
    });

    it('recognises new-file diffs', () => {
        const preview = [
            'diff --git a/src/new.ts b/src/new.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1,2 @@',
            '+hello',
            '+world',
        ].join('\n');
        const parsed = parseDiffPreview(preview);
        expect(parsed?.isNewFile).toBe(true);
        expect(parsed?.filePath).toBe('src/new.ts');
    });

    it('returns undefined for non-diff input', () => {
        expect(parseDiffPreview('')).toBeUndefined();
        expect(parseDiffPreview('just a plain preview message')).toBeUndefined();
        expect(parseDiffPreview('diff --git a/x.ts b/x.ts\nno hunks here')).toBeUndefined();
    });

    it('reconstructs the after-content for a new file', () => {
        const preview = [
            'diff --git a/new.md b/new.md',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/new.md',
            '@@ -0,0 +1,3 @@',
            '+# Title',
            '+',
            '+body',
        ].join('\n');
        const parsed = parseDiffPreview(preview)!;
        const after = applyDiffToContent(parsed, undefined);
        expect(after).toBe('# Title\n\nbody');
    });

    it('applies a single-hunk edit against the current file content', () => {
        const current = [
            'first line',
            'second line',
            'third line',
        ].join('\n');
        const preview = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,3 +1,3 @@',
            ' first line',
            '-second line',
            '+SECOND LINE',
            ' third line',
        ].join('\n');
        const parsed = parseDiffPreview(preview)!;
        const after = applyDiffToContent(parsed, current);
        expect(after).toBe(['first line', 'SECOND LINE', 'third line'].join('\n'));
    });

    it('applies multi-hunk edits with context-line verification', () => {
        const current = [
            'a',
            'b',
            'c',
            'd',
            'e',
            'f',
            'g',
        ].join('\n');
        const preview = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,2 +1,3 @@',
            ' a',
            '+A2',
            ' b',
            '@@ -5,2 +6,2 @@',
            ' e',
            '-f',
            '+F',
        ].join('\n');
        const parsed = parseDiffPreview(preview)!;
        const after = applyDiffToContent(parsed, current);
        // Lines preserved between hunks: c, d; hunks insert A2 and change f→F.
        expect(after).toBe(['a', 'A2', 'b', 'c', 'd', 'e', 'F', 'g'].join('\n'));
    });

    it('aborts when the hunk context does not match the current content', () => {
        const current = 'completely different content';
        const preview = [
            'diff --git a/x.ts b/x.ts',
            '--- a/x.ts',
            '+++ b/x.ts',
            '@@ -1,2 +1,2 @@',
            ' first line',
            '-second line',
            '+SECOND LINE',
        ].join('\n');
        const parsed = parseDiffPreview(preview)!;
        const after = applyDiffToContent(parsed, current);
        expect(after).toBeUndefined();
    });

    it('ignores the "No newline at end of file" marker', () => {
        const preview = [
            'diff --git a/x.ts b/x.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/x.ts',
            '@@ -0,0 +1,1 @@',
            '+final line',
            '\\ No newline at end of file',
        ].join('\n');
        const parsed = parseDiffPreview(preview)!;
        const after = applyDiffToContent(parsed, undefined);
        expect(after).toBe('final line');
    });
});
