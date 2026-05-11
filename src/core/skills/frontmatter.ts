// P17 — Skill / output-style frontmatter parser.
//
// Deliberately minimal: we only recognise the keys the SkillFile / OutputStyleFile
// schemas use (name, description, triggers, tools, systemPromptAppend, responseFormat).
// Parsing rules are a subset of YAML sufficient for those keys:
//   key: scalar                (possibly quoted)
//   key: [a, b, c]             (inline array)
//   key:                       (block list, following lines starting with `  - item`)
//     - a
//     - b
// Comments (`#`) on their own line are ignored. Anything more exotic (nested
// maps, multi-line strings) is out of scope — authors keep skill metadata flat.

export type FrontmatterValue = string | string[];

export interface ParsedFrontmatter {
    metadata: Record<string, FrontmatterValue>;
    body: string;
}

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export function parseSkillFrontmatter(raw: string): ParsedFrontmatter {
    const match = FRONTMATTER_PATTERN.exec(raw);
    if (!match) {
        return { metadata: {}, body: raw };
    }

    const body = raw.slice(match[0].length);
    const metadata = parseFrontmatterBlock(match[1] ?? '');
    return { metadata, body };
}

function parseFrontmatterBlock(block: string): Record<string, FrontmatterValue> {
    const lines = block.split(/\r?\n/);
    const out: Record<string, FrontmatterValue> = {};

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (!kv) continue;

        const key = kv[1]!;
        const inline = (kv[2] ?? '').trim();

        if (inline.length === 0) {
            const items: string[] = [];
            let cursor = i + 1;
            while (cursor < lines.length) {
                const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(lines[cursor] ?? '');
                if (!itemMatch) break;
                items.push(stripQuotes(itemMatch[1]!.trim()));
                cursor += 1;
            }
            if (items.length > 0) {
                out[key] = items;
                i = cursor - 1;
            }
            continue;
        }

        if (inline.startsWith('[') && inline.endsWith(']')) {
            out[key] = inline
                .slice(1, -1)
                .split(',')
                .map((entry) => stripQuotes(entry.trim()))
                .filter(Boolean);
            continue;
        }

        out[key] = stripQuotes(inline);
    }

    return out;
}

function stripQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

export function asStringArray(value: FrontmatterValue | undefined): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

export function asString(value: FrontmatterValue | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
