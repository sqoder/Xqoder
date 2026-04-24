import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SkillDocument {
    name: string;
    filePath: string;
}

export function discoverSkillDocuments(projectRoot: string): SkillDocument[] {
    const documents: SkillDocument[] = [];

    for (const root of getSkillSearchRoots(projectRoot)) {
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
            continue;
        }

        const entries = fs.readdirSync(root, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
                documents.push({
                    name: entry.name.replace(/\.md$/i, ''),
                    filePath: path.join(root, entry.name),
                });
                continue;
            }

            if (!entry.isDirectory()) {
                continue;
            }

            const skillPath = path.join(root, entry.name, 'SKILL.md');
            if (fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
                documents.push({
                    name: entry.name,
                    filePath: skillPath,
                });
            }
        }
    }

    return documents;
}

export function resolveSkillDocumentPath(name: string, projectRoot: string): string | undefined {
    const safeName = sanitizeSkillName(name);
    if (!safeName) {
        return undefined;
    }

    for (const root of getSkillSearchRoots(projectRoot)) {
        const candidates = [
            path.join(root, `${safeName}.md`),
            path.join(root, safeName, 'SKILL.md'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
            }
        }
    }

    return undefined;
}

function getSkillSearchRoots(projectRoot: string): string[] {
    const home = os.homedir();
    return [
        path.join(projectRoot, '.xqoder', 'skills'),
        path.join(projectRoot, '.claude', 'skills'),
        path.join(projectRoot, '.opencode', 'skills'),
        path.join(projectRoot, 'skills'),
        path.join(home, '.agents', 'skills'),
        path.join(home, '.claude', 'skills'),
        path.join(home, '.xqoder', 'skills'),
    ];
}

function sanitizeSkillName(name: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) {
        return undefined;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
