// P17 — Output-style selection persistence.
//
// Chose file-backed per-project state (rather than session metadata) so
// the selection survives across sessions without coupling to P24's session
// persistence work. One file, one key — no schema migration hooks needed.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface SelectionFile {
    name?: string;
}

export function getOutputStyleSelectionPath(projectRoot: string): string {
    return path.join(projectRoot, '.xqoder', 'state', 'output-style.json');
}

export function readOutputStyleSelection(projectRoot: string): string | undefined {
    const filePath = getOutputStyleSelectionPath(projectRoot);
    if (!fs.existsSync(filePath)) return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SelectionFile;
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        return name.length > 0 ? name : undefined;
    } catch {
        return undefined;
    }
}

export function writeOutputStyleSelection(projectRoot: string, name: string): void {
    const filePath = getOutputStyleSelectionPath(projectRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: SelectionFile = { name: name.trim() };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

export function clearOutputStyleSelection(projectRoot: string): void {
    const filePath = getOutputStyleSelectionPath(projectRoot);
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
    }
}
