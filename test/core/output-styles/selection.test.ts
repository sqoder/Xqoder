import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    readOutputStyleSelection,
    writeOutputStyleSelection,
    clearOutputStyleSelection,
    getOutputStyleSelectionPath,
} from '../../../src/core/output-styles/selection.js';

function makeProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xq-style-sel-'));
}

describe('output-style selection persistence', () => {
    it('writes and reads a selection under .xqoder/state/output-style.json', () => {
        const root = makeProject();
        writeOutputStyleSelection(root, 'concise');
        const stored = readOutputStyleSelection(root);
        expect(stored).toBe('concise');
        const onDisk = JSON.parse(fs.readFileSync(getOutputStyleSelectionPath(root), 'utf-8'));
        expect(onDisk.name).toBe('concise');
    });

    it('returns undefined when no selection file exists', () => {
        const root = makeProject();
        expect(readOutputStyleSelection(root)).toBeUndefined();
    });

    it('clears a selection', () => {
        const root = makeProject();
        writeOutputStyleSelection(root, 'verbose');
        clearOutputStyleSelection(root);
        expect(readOutputStyleSelection(root)).toBeUndefined();
    });

    it('returns undefined when state file is malformed', () => {
        const root = makeProject();
        const filePath = getOutputStyleSelectionPath(root);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '{ not json');
        expect(readOutputStyleSelection(root)).toBeUndefined();
    });
});
