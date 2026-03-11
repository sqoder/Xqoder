import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildWrappedEditorLayout,
    buildTerminalCursorPosition,
    buildAttachmentDisplayText,
    clampTerminalCoordinate,
    formatAttachmentDisplayLabel,
    findAtQuery,
    getCompletionDropdownHeight,
    isIgnorableNavigationTail,
    measureEditorRows,
    navigateCompletionSelection,
    normalizeExternalEditorContent,
    parsePendingNavigation,
    resolveAttachmentDeleteKey,
    resolveAcceptedCompletion,
    scanCompletions,
    shouldInsertTrailingBackslashNewline,
    wrapEditorLine,
} from './editor.js';

const tempDirs: string[] = [];

function mkTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-editor-test-'));
    tempDirs.push(dir);
    return dir;
}

describe('editor completions', () => {
    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (!dir) continue;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('finds @ query around cursor position', () => {
        const text = 'please read @src/com';
        const found = findAtQuery(text, text.length);
        expect(found).toEqual({
            start: 'please read '.length,
            query: 'src/com',
        });
    });

    it('prefers directories first and supports fuzzy contains matching', () => {
        const cwd = mkTmpDir();
        fs.mkdirSync(path.join(cwd, 'models'));
        fs.writeFileSync(path.join(cwd, 'model-config.ts'), '', 'utf8');
        fs.writeFileSync(path.join(cwd, 'demo.ts'), '', 'utf8');

        const result = scanCompletions(cwd, 'mod');
        expect(result[0]).toBe('models/');
        expect(result).toContain('model-config.ts');
    });

    it('resolves a full down-arrow sequence even when a stale escape fragment is buffered', () => {
        expect(parsePendingNavigation('\u001b', '\u001b[B')).toEqual({
            action: 'down',
            nextBuffer: '',
        });
    });

    it('resolves a full up-arrow sequence even when a stale CSI fragment is buffered', () => {
        expect(parsePendingNavigation('[', '\u001b[A')).toEqual({
            action: 'up',
            nextBuffer: '',
        });
    });

    it('accepts file completions using the unified textarea cursor offset', () => {
        const resolved = resolveAcceptedCompletion({
            value: 'please read @sr now',
            cursorOffset: 'please read @sr'.length,
            completion: {
                completions: ['src/index.ts'],
                selectedIndex: 0,
                atOffset: 'please read '.length,
                kind: 'file',
            },
        });

        expect(resolved).toEqual({
            value: 'please read @src/index.ts  now',
            offset: 'please read @src/index.ts '.length,
        });
    });

    it('accepts slash completions and appends a space when the command takes args', () => {
        const resolved = resolveAcceptedCompletion({
            value: '/he',
            cursorOffset: '/he'.length,
            completion: {
                completions: ['help'],
                selectedIndex: 0,
                atOffset: 0,
                kind: 'slash',
            },
            slashCommands: [
                {
                    name: 'help',
                    description: 'Show help',
                    args: '<topic>',
                },
            ],
        });

        expect(resolved).toEqual({
            value: '/help ',
            offset: '/help '.length,
        });
    });

    it('returns null when accepting a completion with no selected item', () => {
        expect(resolveAcceptedCompletion({
            value: '@sr',
            cursorOffset: 3,
            completion: {
                completions: [],
                selectedIndex: 0,
                atOffset: 0,
                kind: 'file',
            },
        })).toBeNull();
    });

    it('allocates enough height for a paged completion dropdown', () => {
        expect(getCompletionDropdownHeight({
            completions: Array.from({ length: 36 }, (_, index) => `item-${index}`),
            selectedIndex: 0,
            atOffset: 0,
            kind: 'slash',
        })).toBe(13);

        expect(getCompletionDropdownHeight({
            completions: ['a', 'b'],
            selectedIndex: 0,
            atOffset: 0,
            kind: 'file',
        })).toBe(6);
    });

    it('ignores trailing raw arrow fragments right after a handled down navigation', () => {
        const activeGuard = { direction: 'down' as const, expiresAt: 100 };
        expect(isIgnorableNavigationTail(activeGuard, 'B', 50)).toBe(true);
        expect(isIgnorableNavigationTail(activeGuard, '[B', 50)).toBe(true);
        expect(isIgnorableNavigationTail(activeGuard, '\u001b', 50)).toBe(true);
    });

    it('does not ignore normal typing when there is no active navigation tail guard', () => {
        expect(isIgnorableNavigationTail(null, 'B', 50)).toBe(false);
        expect(isIgnorableNavigationTail(null, 'hello', 50)).toBe(false);
    });

    it('wraps editor rows using terminal width rather than logical lines', () => {
        expect(wrapEditorLine('123456', 8, '> ', 0)).toEqual([
            {
                lineIndex: 0,
                prefix: '> ',
                text: '123456',
                startIndex: 0,
                endIndex: 6,
            },
        ]);

        expect(wrapEditorLine('123456 ', 8, '> ', 0)).toEqual([
            {
                lineIndex: 0,
                prefix: '> ',
                text: '123456',
                startIndex: 0,
                endIndex: 6,
            },
            {
                lineIndex: 0,
                prefix: '',
                text: ' ',
                startIndex: 6,
                endIndex: 7,
            },
        ]);
    });

    it('keeps the cursor anchor on the correct physical row after wrapping', () => {
        expect(buildWrappedEditorLayout('123456', '123456'.length, 8, 4)).toMatchObject({
            rows: [
                { prefix: '> ', text: '123456' },
                { prefix: '', text: ' ' },
            ],
            cursor: {
                x: 0,
                y: 1,
                absoluteRow: 1,
                visibleStartRow: 0,
            },
        });
    });

    it('counts wrapped rows when sizing the editor', () => {
        expect(measureEditorRows('123456', 8)).toBe(2);
        expect(measureEditorRows('1234\nabcd', 8)).toBe(2);
        expect(measureEditorRows('1234567890', 8)).toBe(2);
    });

    it('uses OpenCode-style trailing backslash newline detection', () => {
        expect(shouldInsertTrailingBackslashNewline('hello\\')).toBe(true);
        expect(shouldInsertTrailingBackslashNewline('hello\\nworld')).toBe(false);
        expect(shouldInsertTrailingBackslashNewline('')).toBe(false);
    });

    it('normalizes external editor output without trimming user content', () => {
        expect(normalizeExternalEditorContent('line 1\r\nline 2\n')).toBe('line 1\nline 2\n');
        expect(normalizeExternalEditorContent('')).toBeNull();
    });

    it('renders attachment labels without the legacy @ prefix', () => {
        expect(formatAttachmentDisplayLabel('/tmp/readme.md')).toBe('readme.md');
        expect(formatAttachmentDisplayLabel('/tmp/model-config.ts')).toBe('model-c...');
    });

    it('shows indexed attachment chips while delete mode is active', () => {
        expect(buildAttachmentDisplayText(['/tmp/readme.md', '/tmp/model-config.ts'], false)).toBe('[readme.md] [model-c...]');
        expect(buildAttachmentDisplayText(['/tmp/readme.md', '/tmp/model-config.ts'], true)).toBe('[0:readme.md] [1:model-c...]');
    });

    it('resolves attachment delete key flows like OpenCode', () => {
        expect(resolveAttachmentDeleteKey({
            input: 'r',
            key: { ctrl: true },
            deleteMode: false,
            attachmentsCount: 2,
        })).toEqual({
            handled: true,
            nextDeleteMode: true,
        });

        expect(resolveAttachmentDeleteKey({
            input: '1',
            key: {},
            deleteMode: true,
            attachmentsCount: 2,
        })).toEqual({
            handled: true,
            nextDeleteMode: false,
            removeIndex: 1,
        });

        expect(resolveAttachmentDeleteKey({
            input: 'r',
            key: {},
            deleteMode: true,
            attachmentsCount: 2,
        })).toEqual({
            handled: true,
            nextDeleteMode: false,
            clearAll: true,
        });
    });

    it('clamps terminal cursor coordinates into the visible screen', () => {
        expect(clampTerminalCoordinate(-3, 80)).toBe(0);
        expect(clampTerminalCoordinate(12.9, 80)).toBe(12);
        expect(clampTerminalCoordinate(999, 80)).toBe(79);
        expect(clampTerminalCoordinate(7, undefined)).toBe(7);
    });

    it('applies the input-row offset when mapping to terminal cursor coordinates', () => {
        expect(buildTerminalCursorPosition({
            anchorX: 2,
            anchorY: 10,
            cursorX: 3,
            columns: 80,
            rows: 24,
            offsetY: 1,
        })).toEqual({
            x: 5,
            y: 11,
        });
    });
});
