import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import { parseGitHubRepositoryUrl } from '../github-repo-url.js';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';

const DEFAULT_MAX_FILES = 80;
const HARD_MAX_FILES = 200;
const MAX_WALK_FILES = 5_000;
const MAX_EXCERPT_CHARS = 2_400;
const MAX_README_CHARS = 3_600;
const MAX_OUTPUT_CHARS = 90_000;

const SKIP_DIRECTORIES = new Set([
    '.git',
    '.next',
    '.turbo',
    '.venv',
    '__pycache__',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'target',
    'vendor',
]);

const CONFIG_FILE_PATTERNS = [
    /^package\.json$/i,
    /^bunfig\.toml$/i,
    /^tsconfig(?:\.[^.]+)?\.json$/i,
    /^jsconfig(?:\.[^.]+)?\.json$/i,
    /^vite\.config\.(?:ts|js|mts|mjs|cjs)$/i,
    /^next\.config\.(?:ts|js|mjs|cjs)$/i,
    /^nuxt\.config\.(?:ts|js|mjs)$/i,
    /^pyproject\.toml$/i,
    /^requirements(?:-[^.]+)?\.txt$/i,
    /^go\.mod$/i,
    /^Cargo\.toml$/i,
    /^pom\.xml$/i,
    /^build\.gradle(?:\.kts)?$/i,
    /^settings\.gradle(?:\.kts)?$/i,
    /^Dockerfile$/i,
    /^docker-compose\.ya?ml$/i,
    /^\.github\/workflows\/[^/]+\.ya?ml$/i,
];

const SOURCE_ENTRY_PATTERNS = [
    /^src\/(?:index|main|cli|app|server|tools|commands|QueryEngine)\.(?:ts|tsx|js|jsx|mts|mjs|cjs|py|go|rs|java|kt|swift)$/i,
    /^src\/entrypoints\/[^/]+\.(?:ts|tsx|js|jsx|mts|mjs|cjs)$/i,
    /\/(?:index|main|cli|app|server)\.(?:ts|tsx|js|jsx|mts|mjs|cjs|py|go|rs|java|kt|swift)$/i,
];

type EvidenceCategory = 'overview' | 'config' | 'source' | 'docs';

interface EvidenceFile {
    path: string;
    category: EvidenceCategory;
}

interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    error?: string;
}

/**
 * InspectGitHubRepoTool
 * Shallow-clones a public GitHub repository into .xqoder/remote-repos and
 * returns static, multi-file evidence for repository analysis.
 */
export class InspectGitHubRepoTool implements ITool {
    readonly maxResultSizeChars = MAX_OUTPUT_CHARS;

    readonly definition: ToolDefinition = {
        name: 'inspect_github_repo',
        description: [
            'Inspect a public GitHub repository by shallow-cloning it into the local .xqoder/remote-repos cache.',
            'Returns repository identity, default branch, HEAD commit, file tree summary, README excerpt, key config/package files, likely entry/source excerpts, detected stack, and evidence files.',
            'Use this before answering questions about GitHub repository URLs. It is read-only and never installs dependencies, runs scripts, or executes repository code.',
            'Restrictions: public HTTPS github.com repositories only; optional ref must be a safe branch/tag/commit-like string.',
        ].join('\n'),
        parameters: [
            { name: 'url', type: 'string', description: 'Public GitHub repository URL', required: true },
            { name: 'ref', type: 'string', description: 'Optional branch, tag, or commit-ish to inspect', required: false },
            {
                name: 'maxFiles',
                type: 'number',
                description: `Maximum number of tree files to include (${DEFAULT_MAX_FILES} default, ${HARD_MAX_FILES} max)`,
                required: false,
                default: DEFAULT_MAX_FILES,
            },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const url = String(args['url'] ?? '');
        const parsed = parseGitHubRepositoryUrl(url);
        return {
            toolCallId: String(args['toolCallId'] ?? ''),
            toolName: this.definition.name,
            summary: parsed ? `Inspect GitHub repository: ${parsed.slug}` : `Inspect GitHub repository: ${url}`,
            reason: 'This performs a network git clone/fetch of a public GitHub repository into the local cache',
            risk: 'medium',
        };
    }

    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return false;
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const url = String(args['url'] ?? '').trim();
        const parsed = parseGitHubRepositoryUrl(url);
        if (!parsed) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'url must be a public https://github.com/{owner}/{repo}[.git] repository URL',
            };
        }

        const ref = normalizeRef(args['ref']);
        if (ref === false) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'ref contains unsafe characters or patterns',
            };
        }

        const maxFiles = normalizeMaxFiles(args['maxFiles']);
        const cacheRoot = path.join(context.projectRoot, '.xqoder', 'remote-repos');
        const cachePath = getCachePath(cacheRoot, parsed.slug, ref);

        try {
            fs.mkdirSync(cacheRoot, { recursive: true });
            const cloneResult = ensureShallowClone({
                cacheRoot,
                cachePath,
                cloneUrl: parsed.normalizedUrl,
                ref,
            });
            if (!cloneResult.ok) {
                return {
                    toolCallId,
                    success: false,
                    output: renderCloneFailure({
                        slug: parsed.slug,
                        url,
                        normalizedUrl: parsed.normalizedUrl,
                        ref,
                        error: cloneResult.error ?? cloneResult.stderr,
                    }),
                    error: cloneResult.error ?? cloneResult.stderr,
                    metadata: {
                        url,
                        repository: parsed.slug,
                        ref: ref ?? undefined,
                    },
                };
            }

            const defaultBranch = resolveDefaultBranch(cachePath);
            const headCommit = runGit(['rev-parse', 'HEAD'], cachePath).stdout.trim();
            const shortCommit = runGit(['rev-parse', '--short', 'HEAD'], cachePath).stdout.trim();
            const files = walkRepositoryFiles(cachePath);
            const evidenceFiles = selectEvidenceFiles(files);
            const stack = detectStack(cachePath, files);
            const output = renderInspection({
                url,
                normalizedUrl: parsed.normalizedUrl,
                slug: parsed.slug,
                defaultBranch,
                headCommit,
                shortCommit,
                ref,
                cachePath: path.relative(context.projectRoot, cachePath),
                files,
                maxFiles,
                evidenceFiles,
                stack,
                repoRoot: cachePath,
            });

            return {
                toolCallId,
                success: true,
                output,
                metadata: {
                    url,
                    repository: parsed.slug,
                    defaultBranch,
                    headCommit,
                    ref: ref ?? undefined,
                    fileCount: files.length,
                    evidenceFiles: evidenceFiles.map((entry) => entry.path),
                    cachePath,
                },
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                toolCallId,
                success: false,
                output: '',
                error: `inspect_github_repo failed: ${message}`,
                metadata: {
                    url,
                    repository: parsed.slug,
                    ref: ref ?? undefined,
                },
            };
        }
    }
}

function normalizeMaxFiles(value: unknown): number {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw)) {
        return DEFAULT_MAX_FILES;
    }
    return Math.min(HARD_MAX_FILES, Math.max(1, Math.floor(raw)));
}

function normalizeRef(value: unknown): string | undefined | false {
    if (value === undefined || value === null || String(value).trim() === '') {
        return undefined;
    }
    const ref = String(value).trim();
    if (
        ref.length > 120
        || ref.startsWith('-')
        || ref.includes('..')
        || /[\\\s\x00-\x1f\x7f~^:?*\[]/.test(ref)
        || ref.includes(']')
    ) {
        return false;
    }
    return ref;
}

function getCachePath(cacheRoot: string, slug: string, ref: string | undefined): string {
    const safeName = slug.replace(/[^a-z0-9._-]+/gi, '-');
    const hash = createHash('sha256')
        .update(`${slug}@${ref ?? 'default'}`)
        .digest('hex')
        .slice(0, 10);
    return path.join(cacheRoot, `${safeName}-${hash}`);
}

function ensureShallowClone(input: {
    cacheRoot: string;
    cachePath: string;
    cloneUrl: string;
    ref: string | undefined;
}): GitResult {
    if (fs.existsSync(path.join(input.cachePath, '.git'))) {
        return { ok: true, stdout: '', stderr: '' };
    }

    const resolvedRoot = path.resolve(input.cacheRoot);
    const resolvedCachePath = path.resolve(input.cachePath);
    if (!resolvedCachePath.startsWith(`${resolvedRoot}${path.sep}`)) {
        return {
            ok: false,
            stdout: '',
            stderr: '',
            error: 'refusing to clone outside .xqoder/remote-repos cache',
        };
    }

    fs.rmSync(input.cachePath, { recursive: true, force: true });
    const cloneArgs = [
        'clone',
        '--depth',
        '1',
        ...(input.ref ? ['--branch', input.ref] : []),
        input.cloneUrl,
        input.cachePath,
    ];
    return runGit(cloneArgs, input.cacheRoot, 90_000);
}

function runGit(args: string[], cwd: string, timeout = 30_000): GitResult {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
    });
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    if (result.error) {
        return {
            ok: false,
            stdout,
            stderr,
            error: result.error.message,
        };
    }
    return {
        ok: result.status === 0,
        stdout,
        stderr,
        error: result.status === 0 ? undefined : stderr || stdout || `git exited with status ${result.status}`,
    };
}

function resolveDefaultBranch(repoRoot: string): string {
    const remoteHead = runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot);
    const remoteBranch = remoteHead.stdout.trim().replace(/^origin\//, '');
    if (remoteBranch) {
        return remoteBranch;
    }

    const localBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).stdout.trim();
    return localBranch && localBranch !== 'HEAD' ? localBranch : '(detached)';
}

function walkRepositoryFiles(repoRoot: string): string[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
        if (files.length >= MAX_WALK_FILES) {
            return;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true })
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch {
            return;
        }

        for (const entry of entries) {
            if (files.length >= MAX_WALK_FILES) {
                return;
            }
            if (entry.isSymbolicLink()) {
                continue;
            }
            const absolutePath = path.join(directory, entry.name);
            const relativePath = toPosixRelative(repoRoot, absolutePath);
            if (entry.isDirectory()) {
                if (!SKIP_DIRECTORIES.has(entry.name)) {
                    visit(absolutePath);
                }
                continue;
            }
            if (entry.isFile()) {
                files.push(relativePath);
            }
        }
    };
    visit(repoRoot);
    return files;
}

function toPosixRelative(root: string, absolutePath: string): string {
    return path.relative(root, absolutePath).split(path.sep).join('/');
}

function selectEvidenceFiles(files: string[]): EvidenceFile[] {
    const evidence: EvidenceFile[] = [];
    const seen = new Set<string>();
    const add = (file: string | undefined, category: EvidenceCategory): void => {
        if (!file || seen.has(file)) {
            return;
        }
        seen.add(file);
        evidence.push({ path: file, category });
    };

    add(files.find((file) => /^readme(?:\.[a-z0-9_-]+)?\.md$/i.test(path.basename(file))), 'overview');
    add(files.find((file) => /^features\.md$/i.test(path.basename(file))), 'docs');

    for (const file of files.filter(isConfigFile).slice(0, 8)) {
        add(file, 'config');
    }
    for (const file of files.filter(isSourceEntryFile).slice(0, 8)) {
        add(file, 'source');
    }
    for (const file of files.filter(isLikelySourceFile).slice(0, 6)) {
        add(file, 'source');
    }
    for (const file of files.filter((entry) => /\.md$/i.test(entry) && !seen.has(entry)).slice(0, 4)) {
        add(file, 'docs');
    }

    return evidence.slice(0, 18);
}

function isConfigFile(file: string): boolean {
    return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

function isSourceEntryFile(file: string): boolean {
    return SOURCE_ENTRY_PATTERNS.some((pattern) => pattern.test(file));
}

function isLikelySourceFile(file: string): boolean {
    return /^src\/.+\.(?:ts|tsx|js|jsx|mts|mjs|cjs|py|go|rs|java|kt|swift)$/i.test(file);
}

function detectStack(repoRoot: string, files: string[]): string[] {
    const stack = new Set<string>();
    const packageJsonPath = path.join(repoRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        stack.add('Node.js');
        const packageJson = readJsonFile(packageJsonPath);
        const deps = {
            ...asObject(packageJson?.['dependencies']),
            ...asObject(packageJson?.['devDependencies']),
            ...asObject(packageJson?.['peerDependencies']),
        };
        const packageManager = String(packageJson?.['packageManager'] ?? '');
        if (packageManager.includes('bun') || files.some((file) => /^bun\.lockb?$/i.test(file))) {
            stack.add('Bun');
        }
        if (deps['typescript'] || files.some((file) => /\.(ts|tsx)$/i.test(file))) {
            stack.add('TypeScript');
        }
        if (deps['react'] || files.some((file) => /\.(tsx|jsx)$/i.test(file))) {
            stack.add('React');
        }
        if (deps['ink']) stack.add('Ink terminal UI');
        if (deps['commander']) stack.add('Commander CLI');
        if (deps['zod']) stack.add('Zod');
        if (deps['vite']) stack.add('Vite');
        if (deps['next']) stack.add('Next.js');
        if (deps['express']) stack.add('Express');
    }

    if (files.includes('pyproject.toml') || files.some((file) => /\.py$/i.test(file))) stack.add('Python');
    if (files.includes('go.mod') || files.some((file) => /\.go$/i.test(file))) stack.add('Go');
    if (files.includes('Cargo.toml') || files.some((file) => /\.rs$/i.test(file))) stack.add('Rust');
    if (files.includes('pom.xml') || files.some((file) => /\.(java|kt)$/i.test(file))) stack.add('JVM');
    if (files.includes('Dockerfile') || files.some((file) => /^\.github\/workflows\//i.test(file))) {
        stack.add('CI/DevOps config');
    }

    return [...stack];
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : undefined;
    } catch {
        return undefined;
    }
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function renderInspection(input: {
    url: string;
    normalizedUrl: string;
    slug: string;
    defaultBranch: string;
    headCommit: string;
    shortCommit: string;
    ref: string | undefined;
    cachePath: string;
    files: string[];
    maxFiles: number;
    evidenceFiles: EvidenceFile[];
    stack: string[];
    repoRoot: string;
}): string {
    const hasStructure = input.files.length > 0;
    const overview = input.evidenceFiles.find((entry) => entry.category === 'overview');
    const sourceOrConfig = input.evidenceFiles.find((entry) => entry.category === 'source' || entry.category === 'config');
    const treeFiles = input.files.slice(0, input.maxFiles);
    const lines = [
        '# GitHub Repository Inspection',
        '',
        `Repository: ${input.slug}`,
        `Input URL: ${input.url}`,
        `Clone URL: ${input.normalizedUrl}`,
        `Default branch: ${input.defaultBranch}`,
        `HEAD commit: ${input.headCommit || input.shortCommit || '(unknown)'}`,
        `Requested ref: ${input.ref ?? '(default)'}`,
        `Local cache: ${input.cachePath}`,
        '',
        '## Evidence completeness',
        `- structure: ${hasStructure ? 'yes' : 'no'} (${input.files.length} files discovered)`,
        `- overview: ${overview ? `yes (${overview.path})` : 'no'}`,
        `- source/config: ${sourceOrConfig ? `yes (${sourceOrConfig.path})` : 'no'}`,
        '',
        '## Detected stack',
        input.stack.length > 0 ? input.stack.map((entry) => `- ${entry}`).join('\n') : '- (none detected from static files)',
        '',
        '## File tree summary',
        ...summarizeTopLevel(input.files),
        '',
        `## File tree (first ${treeFiles.length} of ${input.files.length})`,
        treeFiles.map((file) => `- ${file}`).join('\n') || '- (empty repository)',
        '',
        '## Key evidence files',
        ...input.evidenceFiles.flatMap((entry) => renderEvidenceFile(input.repoRoot, entry)),
        '',
        '## Analysis requirement',
        'Base repository conclusions on the inspected files above. Do not answer from README alone when source/config evidence is available.',
    ];

    const output = lines.join('\n');
    if (output.length <= MAX_OUTPUT_CHARS) {
        return output;
    }
    return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n... [inspect_github_repo output truncated]`;
}

function summarizeTopLevel(files: string[]): string[] {
    const counts = new Map<string, number>();
    for (const file of files) {
        const top = file.includes('/') ? `${file.split('/')[0]}/` : file;
        counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 30)
        .map(([entry, count]) => `- ${entry}: ${count} file${count === 1 ? '' : 's'}`);
}

function renderEvidenceFile(repoRoot: string, evidence: EvidenceFile): string[] {
    const excerpt = readFileExcerpt(path.join(repoRoot, evidence.path), evidence.category === 'overview'
        ? MAX_README_CHARS
        : MAX_EXCERPT_CHARS);
    return [
        '',
        `### ${evidence.path} (${evidence.category})`,
        `\`\`\`${fenceLanguage(evidence.path)}`,
        excerpt,
        '```',
    ];
}

function readFileExcerpt(filePath: string, maxChars: number): string {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > 800_000) {
            return `[Skipped large file: ${stat.size} bytes]`;
        }
        const raw = fs.readFileSync(filePath);
        if (raw.includes(0)) {
            return '[Skipped binary file]';
        }
        const text = raw.toString('utf8').replace(/\r\n/g, '\n');
        if (text.length <= maxChars) {
            return text;
        }
        return `${text.slice(0, maxChars)}\n\n... [excerpt truncated, original length: ${text.length} chars]`;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `[Could not read file excerpt: ${message}]`;
    }
}

function fenceLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.json': return 'json';
        case '.md': return 'md';
        case '.ts': return 'ts';
        case '.tsx': return 'tsx';
        case '.js':
        case '.mjs':
        case '.cjs': return 'js';
        case '.jsx': return 'jsx';
        case '.toml': return 'toml';
        case '.yaml':
        case '.yml': return 'yaml';
        case '.py': return 'py';
        case '.go': return 'go';
        case '.rs': return 'rust';
        case '.java': return 'java';
        case '.kt': return 'kotlin';
        case '.swift': return 'swift';
        case '.xml': return 'xml';
        default: return '';
    }
}

function renderCloneFailure(input: {
    slug: string;
    url: string;
    normalizedUrl: string;
    ref: string | undefined;
    error: string;
}): string {
    return [
        '# GitHub Repository Inspection Failed',
        '',
        `Repository: ${input.slug}`,
        `Input URL: ${input.url}`,
        `Clone URL: ${input.normalizedUrl}`,
        `Requested ref: ${input.ref ?? '(default)'}`,
        '',
        'The repository could not be cloned, so no file tree/source evidence is available.',
        'If an answer is produced after this failure, it must explicitly say it is limited to non-clone evidence such as README/webpage fetches.',
        '',
        'Error:',
        '```',
        input.error.trim(),
        '```',
    ].join('\n');
}
