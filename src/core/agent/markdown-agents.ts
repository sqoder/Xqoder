import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentMode, AgentPermissionMode } from '@xqoder/shared';

export type MarkdownAgentSource = 'project-markdown' | 'user-markdown';

export interface MarkdownAgentDefinition {
    name: string;
    mode: AgentMode;
    description?: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: AgentPermissionMode;
    source: MarkdownAgentSource;
    filePath: string;
}

type ParsedFrontmatterValue = string | string[];

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const PROJECT_AGENT_DIR = path.join('.claude', 'agents');
const SUPPORTED_AGENT_MODES = new Set<AgentMode>(['primary', 'subagent']);
const SUPPORTED_PERMISSION_MODES = new Set<AgentPermissionMode>([
    'allow',
    'ask',
    'deny',
    'auto',
    'plan',
    'default',
    'bypassPermissions',
]);

export interface MarkdownAgentLookupOptions {
    cwd?: string;
    /**
     * Override the user-level agents directory lookup. Primarily used by
     * tests to stay hermetic against the developer's real `~/.claude/agents`
     * layout. Defaults to `~/.claude/agents`.
     */
    userAgentDir?: string;
}

function resolveUserAgentDir(override: string | undefined): string {
    return override ?? path.join(os.homedir(), '.claude', 'agents');
}

export function listMarkdownAgents(
    cwdOrOptions: string | MarkdownAgentLookupOptions = process.cwd(),
): MarkdownAgentDefinition[] {
    const options: MarkdownAgentLookupOptions = typeof cwdOrOptions === 'string'
        ? { cwd: cwdOrOptions }
        : cwdOrOptions;
    const cwd = options.cwd ?? process.cwd();
    const userAgentDir = resolveUserAgentDir(options.userAgentDir);

    const deduped = new Map<string, MarkdownAgentDefinition>();

    for (const agent of readMarkdownAgentsFromDir(userAgentDir, 'user-markdown')) {
        deduped.set(agent.name, agent);
    }

    for (const agent of readMarkdownAgentsFromDir(path.resolve(cwd, PROJECT_AGENT_DIR), 'project-markdown')) {
        deduped.set(agent.name, agent);
    }

    return Array.from(deduped.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function getMarkdownAgentDefinition(
    name: string,
    cwdOrOptions: string | MarkdownAgentLookupOptions = process.cwd(),
): MarkdownAgentDefinition | undefined {
    const normalizedName = name.trim();
    if (!normalizedName) {
        return undefined;
    }

    return listMarkdownAgents(cwdOrOptions).find((agent) => agent.name === normalizedName);
}

function readMarkdownAgentsFromDir(
    directory: string,
    source: MarkdownAgentSource,
): MarkdownAgentDefinition[] {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        return [];
    }

    return collectMarkdownAgentFiles(directory)
        .map((filePath) => parseMarkdownAgentFile(filePath, source))
        .filter((agent): agent is MarkdownAgentDefinition => Boolean(agent));
}

function collectMarkdownAgentFiles(directory: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(path.join(directory, entry.name));
            continue;
        }

        if (!entry.isDirectory()) {
            continue;
        }

        const nestedAgentFile = path.join(directory, entry.name, 'AGENT.md');
        if (fs.existsSync(nestedAgentFile) && fs.statSync(nestedAgentFile).isFile()) {
            files.push(nestedAgentFile);
        }
    }

    return files;
}

function parseMarkdownAgentFile(
    filePath: string,
    source: MarkdownAgentSource,
): MarkdownAgentDefinition | undefined {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const trimmedRaw = raw.trim();
    if (!trimmedRaw) {
        return undefined;
    }

    const { frontmatter, body } = splitFrontmatter(raw);
    const metadata = parseFrontmatter(frontmatter);
    const prompt = body.trim();
    if (!prompt) {
        return undefined;
    }

    const derivedName = deriveAgentName(filePath);
    const name = asTrimmedString(
        metadata.name,
        metadata.agent,
        derivedName,
    );
    if (!name) {
        return undefined;
    }

    const mode = normalizeAgentMode(
        asTrimmedString(metadata.mode),
    ) ?? 'subagent';
    const description = asTrimmedString(metadata.description, metadata.summary);
    const tools = normalizeToolList(metadata.tools, metadata.allowedTools, metadata.allowed_tools);
    const disallowedTools = normalizeToolList(metadata.disallowedTools, metadata.disallowed_tools);
    const model = asTrimmedString(metadata.model);
    const permissionMode = normalizePermissionMode(
        asTrimmedString(metadata.permissionMode, metadata.permission_mode),
    );

    return {
        name,
        mode,
        ...(description ? { description } : {}),
        prompt,
        ...(tools.length > 0 ? { tools } : {}),
        ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
        ...(model ? { model } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        source,
        filePath,
    };
}

function splitFrontmatter(raw: string): {
    frontmatter?: string;
    body: string;
} {
    const match = FRONTMATTER_PATTERN.exec(raw);
    if (!match) {
        return {
            body: raw,
        };
    }

    return {
        frontmatter: match[1],
        body: raw.slice(match[0].length),
    };
}

function parseFrontmatter(frontmatter: string | undefined): Record<string, ParsedFrontmatterValue> {
    if (!frontmatter) {
        return {};
    }

    const parsed: Record<string, ParsedFrontmatterValue> = {};
    const lines = frontmatter.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (!match) {
            continue;
        }

        const key = match[1];
        const inlineValue = match[2].trim();
        if (inlineValue.length === 0) {
            const items: string[] = [];
            let cursor = index + 1;
            while (cursor < lines.length) {
                const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(lines[cursor] ?? '');
                if (!itemMatch) {
                    break;
                }
                items.push(stripWrappingQuotes(itemMatch[1].trim()));
                cursor += 1;
            }
            if (items.length > 0) {
                parsed[key] = items;
                index = cursor - 1;
            }
            continue;
        }

        if (inlineValue.startsWith('[') && inlineValue.endsWith(']')) {
            parsed[key] = inlineValue
                .slice(1, -1)
                .split(',')
                .map((entry) => stripWrappingQuotes(entry.trim()))
                .filter(Boolean);
            continue;
        }

        parsed[key] = stripWrappingQuotes(inlineValue);
    }

    return parsed;
}

function deriveAgentName(filePath: string): string {
    const baseName = path.basename(filePath);
    if (baseName === 'AGENT.md') {
        return path.basename(path.dirname(filePath));
    }

    return baseName.replace(/\.md$/i, '');
}

function normalizeAgentMode(value: string | undefined): AgentMode | undefined {
    if (!value || !SUPPORTED_AGENT_MODES.has(value as AgentMode)) {
        return undefined;
    }

    return value as AgentMode;
}

function normalizePermissionMode(value: string | undefined): AgentPermissionMode | undefined {
    if (!value || !SUPPORTED_PERMISSION_MODES.has(value as AgentPermissionMode)) {
        return undefined;
    }

    return value as AgentPermissionMode;
}

function normalizeToolList(...values: Array<ParsedFrontmatterValue | undefined>): string[] {
    const tools: string[] = [];
    for (const value of values) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                const normalized = entry.trim();
                if (normalized) {
                    tools.push(normalized);
                }
            }
            continue;
        }

        if (typeof value === 'string') {
            for (const entry of value.split(',')) {
                const normalized = entry.trim();
                if (normalized) {
                    tools.push(normalized);
                }
            }
        }
    }

    return Array.from(new Set(tools));
}

function asTrimmedString(...values: Array<ParsedFrontmatterValue | undefined>): string | undefined {
    for (const value of values) {
        if (typeof value === 'string') {
            const normalized = value.trim();
            if (normalized) {
                return normalized;
            }
        }
    }

    return undefined;
}

function stripWrappingQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }

    return value;
}
