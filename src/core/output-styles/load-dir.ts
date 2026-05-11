// P17 — Output style loader.
//
// Structurally similar to skill loader but the schema differs:
//   - `systemPromptAppend` overrides the markdown body (explicit > implicit)
//   - `responseFormat` is restricted to a closed enum
//
// Output styles do not carry triggers or allowed-tools; they purely mutate
// how the model responds.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { asString, parseSkillFrontmatter } from '../skills/frontmatter.js';

export type OutputStyleResponseFormat = 'markdown' | 'plain' | 'verbose';

export interface OutputStyleFile {
    readonly name: string;
    readonly description: string;
    readonly systemPromptAppend?: string;
    readonly responseFormat?: OutputStyleResponseFormat;
    readonly filePath: string;
}

const RESPONSE_FORMATS = new Set<OutputStyleResponseFormat>(['markdown', 'plain', 'verbose']);

export function loadOutputStylesDir(roots: string | readonly string[]): OutputStyleFile[] {
    const rootList = typeof roots === 'string' ? [roots] : [...roots];
    const deduped = new Map<string, OutputStyleFile>();

    for (const root of rootList) {
        for (const style of readStylesFromDir(root)) {
            if (!deduped.has(style.name)) {
                deduped.set(style.name, style);
            }
        }
    }

    return Array.from(deduped.values())
        .sort((left, right) => left.name.localeCompare(right.name));
}

function readStylesFromDir(root: string): OutputStyleFile[] {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [];
    }

    const entries = fs.readdirSync(root, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    const styles: OutputStyleFile[] = [];

    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'STYLE.md') {
            const parsed = parseStyleAt(path.join(root, entry.name));
            if (parsed) styles.push(parsed);
            continue;
        }
        if (!entry.isDirectory()) continue;
        const styleMd = path.join(root, entry.name, 'STYLE.md');
        if (fs.existsSync(styleMd) && fs.statSync(styleMd).isFile()) {
            const parsed = parseStyleAt(styleMd, entry.name);
            if (parsed) styles.push(parsed);
        }
    }

    return styles;
}

function parseStyleAt(filePath: string, fallbackName?: string): OutputStyleFile | undefined {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { metadata, body } = parseSkillFrontmatter(raw);

    const name = asString(metadata.name)
        ?? fallbackName
        ?? deriveNameFromPath(filePath);
    const description = asString(metadata.description);
    if (!name || !description) return undefined;

    const explicitAppend = asString(metadata.systemPromptAppend);
    const bodyAppend = body.trim();
    const systemPromptAppend = explicitAppend ?? (bodyAppend.length > 0 ? bodyAppend : undefined);

    const rawFormat = asString(metadata.responseFormat);
    const responseFormat = rawFormat && RESPONSE_FORMATS.has(rawFormat as OutputStyleResponseFormat)
        ? (rawFormat as OutputStyleResponseFormat)
        : undefined;

    return {
        name,
        description,
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
        ...(responseFormat ? { responseFormat } : {}),
        filePath,
    };
}

function deriveNameFromPath(filePath: string): string | undefined {
    const base = path.basename(filePath);
    if (base === 'STYLE.md') return path.basename(path.dirname(filePath));
    const stripped = base.replace(/\.md$/i, '');
    return stripped || undefined;
}
