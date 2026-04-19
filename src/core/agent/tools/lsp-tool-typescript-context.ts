import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import type {
    CompletionMatch as LspCompletionMatch,
    HoverMatch as LspHoverMatch,
    RenameMatch as LspRenameMatch,
    TextEditMatch as LspTextEditMatch,
    DiagnosticMatch as LspDiagnosticMatch,
    LocationMatch as LspLocationMatch,
    WorkspaceSymbolMatch as LspSymbolMatch,
} from '../lsp.js';

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
};

const SUPPORTED_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mts',
    '.cts',
    '.mjs',
    '.cjs',
]);

const SKIPPED_DIRECTORIES = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
]);

const MAX_RESULTS = 50;
const tsContextCache = new Map<string, { ctx: TypeScriptWorkspaceContext; at: number }>();
const TS_CONTEXT_CACHE_TTL_MS = 60_000;
const TS_CONTEXT_CACHE_MAX = 1;

export function getOrCreateTsContext(projectRoot: string): TypeScriptWorkspaceContext {
    const key = path.resolve(projectRoot);
    const now = Date.now();
    const cached = tsContextCache.get(key);
    if (cached) {
        if (now - cached.at < TS_CONTEXT_CACHE_TTL_MS) {
            return cached.ctx;
        }
        tsContextCache.delete(key);
    }
    if (tsContextCache.size >= TS_CONTEXT_CACHE_MAX) {
        const oldest = [...tsContextCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) {
            tsContextCache.delete(oldest[0]);
        }
    }
    const ctx = new TypeScriptWorkspaceContext(key);
    tsContextCache.set(key, { ctx, at: now });
    return ctx;
}

export class TypeScriptWorkspaceContext {
    private readonly projectRoot: string;
    private readonly fileNames: string[];
    private readonly fileSet: Set<string>;
    private readonly compilerOptions: ts.CompilerOptions;
    private readonly languageService: ts.LanguageService;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        const { fileNames, compilerOptions } = loadWorkspaceConfiguration(this.projectRoot);
        this.fileNames = fileNames;
        this.fileSet = new Set(fileNames);
        this.compilerOptions = compilerOptions;
        this.languageService = ts.createLanguageService({
            getCompilationSettings: () => this.compilerOptions,
            getScriptFileNames: () => [...this.fileNames],
            getScriptVersion: (fileName) => this.getScriptVersion(fileName),
            getScriptSnapshot: (fileName) => this.getScriptSnapshot(fileName),
            getCurrentDirectory: () => this.projectRoot,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        }, ts.createDocumentRegistry());
    }

    findWorkspaceSymbols(query: string, limit: number): LspSymbolMatch[] {
        const normalizedQuery = query.trim().toLowerCase();
        const matches: LspSymbolMatch[] = [];

        for (const fileName of this.fileNames) {
            const sourceFile = this.getSourceFile(fileName);
            const tree = this.languageService.getNavigationTree(fileName);
            collectNavigationMatches(
                tree,
                sourceFile,
                normalizedQuery,
                [],
                matches,
                limit,
            );
            if (matches.length >= limit) {
                break;
            }
        }

        return matches;
    }

    getFileDiagnostics(filePath: string): LspDiagnosticMatch[] {
        this.ensureTrackedFile(filePath);

        const diagnostics = [
            ...this.languageService.getCompilerOptionsDiagnostics(),
            ...this.languageService.getSyntacticDiagnostics(filePath),
            ...this.languageService.getSemanticDiagnostics(filePath),
            ...this.languageService.getSuggestionDiagnostics(filePath),
        ];

        return diagnostics
            .map((diagnostic) => toDiagnosticMatch(diagnostic))
            .filter((match): match is LspDiagnosticMatch => match !== null);
    }

    findDefinitions(filePath: string, line: number, character: number): LspLocationMatch[] {
        this.ensureTrackedFile(filePath);
        const offset = this.toOffset(filePath, line, character);
        const definitions = this.languageService.getDefinitionAtPosition(filePath, offset) ?? [];

        return definitions.map((definition) => toLocationMatch(
            definition.fileName,
            definition.textSpan.start,
            definition.kind,
        ));
    }

    findReferences(
        filePath: string,
        line: number,
        character: number,
        limit: number,
    ): LspLocationMatch[] {
        this.ensureTrackedFile(filePath);
        const offset = this.toOffset(filePath, line, character);
        const references = this.languageService.getReferencesAtPosition(filePath, offset) ?? [];

        return references
            .slice(0, limit)
            .map((reference) => toLocationMatch(reference.fileName, reference.textSpan.start));
    }

    getHover(filePath: string, line: number, character: number): LspHoverMatch | null {
        this.ensureTrackedFile(filePath);
        const offset = this.toOffset(filePath, line, character);
        const quickInfo = this.languageService.getQuickInfoAtPosition(filePath, offset);
        if (!quickInfo) {
            return null;
        }

        const documentation = ts.displayPartsToString(quickInfo.documentation);
        const signature = ts.displayPartsToString(quickInfo.displayParts);
        const contents = [
            signature ? `\`\`\`ts\n${signature}\n\`\`\`` : '',
            documentation,
        ].filter(Boolean).join('\n\n');
        const start = getLineAndCharacter(this.getSourceFile(filePath), quickInfo.textSpan.start);
        const end = getLineAndCharacter(
            this.getSourceFile(filePath),
            quickInfo.textSpan.start + quickInfo.textSpan.length,
        );

        return {
            contents,
            range: {
                line: start.line,
                character: start.character,
                endLine: end.line,
                endCharacter: end.character,
            },
        };
    }

    getCompletions(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        resolveDetails = false,
        resolveLimit = Math.min(limit, 5),
    ): LspCompletionMatch[] {
        this.ensureTrackedFile(filePath);
        const offset = this.toOffset(filePath, line, character);
        const completions = this.languageService.getCompletionsAtPosition(filePath, offset, {
            includeInsertTextCompletions: true,
        });

        return (completions?.entries ?? [])
            .slice(0, limit)
            .map((entry, index) => {
                const baseMatch: LspCompletionMatch = {
                    label: entry.name,
                    kind: entry.kind,
                    ...(entry.kindModifiers ? { detail: entry.kindModifiers } : {}),
                    ...(entry.insertText ? { insertText: entry.insertText } : {}),
                    ...(entry.sortText ? { sortText: entry.sortText } : {}),
                };

                if (!resolveDetails || index >= resolveLimit) {
                    return baseMatch;
                }

                const details = this.languageService.getCompletionEntryDetails(
                    filePath,
                    offset,
                    entry.name,
                    undefined,
                    entry.source,
                    undefined,
                    entry.data,
                );
                if (!details) {
                    return baseMatch;
                }

                const documentation = ts.displayPartsToString(details.documentation);
                const detailText = ts.displayPartsToString(details.displayParts);

                return {
                    ...baseMatch,
                    ...(detailText ? { detail: detailText } : {}),
                    ...(documentation ? { documentation } : {}),
                    resolved: true,
                };
            });
    }

    renameSymbol(
        filePath: string,
        line: number,
        character: number,
        newName: string,
    ): LspRenameMatch | null {
        this.ensureTrackedFile(filePath);
        const offset = this.toOffset(filePath, line, character);
        const renameInfo = this.languageService.getRenameInfo(filePath, offset, {
            allowRenameOfImportPath: false,
        });

        if (!renameInfo.canRename) {
            throw new Error((renameInfo as any).localizedErrorMessage || 'Current position cannot be renamed');
        }

        const locations = this.languageService.findRenameLocations(
            filePath,
            offset,
            false,
            false,
            false,
        ) ?? [];

        if (locations.length === 0) {
            return null;
        }

        const edits = locations.map((location) => toTextEditMatch(
            location.fileName,
            location.textSpan.start,
            location.textSpan.length,
            newName,
        ));

        return {
            filePaths: Array.from(new Set(edits.map((edit) => edit.filePath))),
            edits,
            totalEdits: edits.length,
            placeholder: renameInfo.displayName,
        };
    }

    private ensureTrackedFile(filePath: string): void {
        const resolvedFilePath = path.resolve(filePath);
        if (!isSupportedSourceFile(resolvedFilePath)) {
            throw new Error(`Currently only TS/JS files are supported: ${resolvedFilePath}`);
        }
        if (!fs.existsSync(resolvedFilePath)) {
            throw new Error(`File does not exist: ${resolvedFilePath}`);
        }
        if (!this.fileSet.has(resolvedFilePath)) {
            this.fileNames.push(resolvedFilePath);
            this.fileSet.add(resolvedFilePath);
        }
    }

    private toOffset(filePath: string, line: number, character: number): number {
        const normalizedLine = Math.max(1, Math.floor(line));
        const normalizedCharacter = Math.max(1, Math.floor(character));
        const sourceFile = this.getSourceFile(filePath);

        return ts.getPositionOfLineAndCharacter(
            sourceFile,
            normalizedLine - 1,
            normalizedCharacter - 1,
        );
    }

    private getSourceFile(filePath: string): ts.SourceFile {
        const program = this.languageService.getProgram();
        const sourceFile = program?.getSourceFile(filePath);

        if (sourceFile) {
            return sourceFile;
        }

        return ts.createSourceFile(
            filePath,
            fs.readFileSync(filePath, 'utf-8'),
            this.compilerOptions.target ?? ts.ScriptTarget.ES2022,
            true,
        );
    }

    private getScriptVersion(fileName: string): string {
        try {
            const stats = fs.statSync(fileName);
            return `${stats.mtimeMs}`;
        } catch {
            return '0';
        }
    }

    private getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
        if (!fs.existsSync(fileName)) {
            return undefined;
        }

        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    }
}

function loadWorkspaceConfiguration(projectRoot: string): {
    fileNames: string[];
    compilerOptions: ts.CompilerOptions;
} {
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists);
    if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        if (configFile.error) {
            throw new Error(formatDiagnosticMessage(configFile.error.messageText));
        }

        const parsed = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(configPath),
            DEFAULT_COMPILER_OPTIONS,
            configPath,
        );

        return {
            fileNames: parsed.fileNames.filter(isSupportedSourceFile),
            compilerOptions: {
                ...DEFAULT_COMPILER_OPTIONS,
                ...parsed.options,
            },
        };
    }

    return {
        fileNames: discoverWorkspaceFiles(projectRoot),
        compilerOptions: DEFAULT_COMPILER_OPTIONS,
    };
}

function collectNavigationMatches(
    tree: ts.NavigationTree,
    sourceFile: ts.SourceFile,
    query: string,
    containers: string[],
    matches: LspSymbolMatch[],
    limit: number,
): void {
    if (matches.length >= limit) {
        return;
    }

    const nextContainers = tree.text !== '<global>' && tree.text !== '<function>' && tree.text !== '<class>'
        ? [...containers, tree.text]
        : containers;

    if (tree.text.toLowerCase().includes(query) && tree.spans.length > 0 && tree.kind !== 'module') {
        const location = getLineAndCharacter(sourceFile, tree.spans[0].start);
        matches.push({
            kind: tree.kind,
            name: tree.text,
            filePath: sourceFile.fileName,
            line: location.line,
            character: location.character,
            preview: getLinePreview(sourceFile, tree.spans[0].start),
            ...(containers.length > 0 ? { containerName: containers.join(' > ') } : {}),
        });
    }

    for (const child of tree.childItems ?? []) {
        collectNavigationMatches(child, sourceFile, query, nextContainers, matches, limit);
        if (matches.length >= limit) {
            return;
        }
    }
}

function toDiagnosticMatch(diagnostic: ts.Diagnostic): LspDiagnosticMatch | null {
    if (!diagnostic.file || diagnostic.start === undefined) {
        return null;
    }

    const location = getLineAndCharacter(diagnostic.file, diagnostic.start);
    return {
        severity: ts.DiagnosticCategory[diagnostic.category].toUpperCase(),
        code: `TS${diagnostic.code}`,
        filePath: diagnostic.file.fileName,
        line: location.line,
        character: location.character,
        message: formatDiagnosticMessage(diagnostic.messageText),
    };
}

function toLocationMatch(
    filePath: string,
    start: number,
    kind?: string,
): LspLocationMatch {
    const sourceText = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true);
    const location = getLineAndCharacter(sourceFile, start);

    return {
        filePath,
        line: location.line,
        character: location.character,
        preview: getLinePreview(sourceFile, start),
        ...(kind ? { kind } : {}),
    };
}

function toTextEditMatch(
    filePath: string,
    start: number,
    length: number,
    newText: string,
): LspTextEditMatch {
    const sourceText = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true);
    const startLocation = getLineAndCharacter(sourceFile, start);
    const endLocation = getLineAndCharacter(sourceFile, start + length);

    return {
        filePath,
        startLine: startLocation.line,
        startCharacter: startLocation.character,
        endLine: endLocation.line,
        endCharacter: endLocation.character,
        newText,
    };
}

export function groupTextEditsByFile(edits: LspTextEditMatch[]): Map<string, LspTextEditMatch[]> {
    const grouped = new Map<string, LspTextEditMatch[]>();

    for (const edit of edits) {
        const existing = grouped.get(edit.filePath) ?? [];
        existing.push(edit);
        grouped.set(edit.filePath, existing);
    }

    return grouped;
}

export function applyTextEditsToContent(content: string, edits: LspTextEditMatch[]): string {
    const normalized = edits
        .map((edit) => ({
            ...edit,
            startOffset: positionToOffset(content, edit.startLine, edit.startCharacter),
            endOffset: positionToOffset(content, edit.endLine, edit.endCharacter),
        }))
        .sort((left, right) => {
            if (left.startOffset !== right.startOffset) {
                return right.startOffset - left.startOffset;
            }
            return right.endOffset - left.endOffset;
        });

    let nextContent = content;
    let lastStart = Number.POSITIVE_INFINITY;

    for (const edit of normalized) {
        if (edit.startOffset > edit.endOffset) {
            throw new Error(`Invalid text edit range: ${edit.filePath}`);
        }
        if (edit.endOffset > lastStart) {
            throw new Error(`Detected overlapping text edits: ${edit.filePath}`);
        }

        nextContent = `${nextContent.slice(0, edit.startOffset)}${edit.newText}${nextContent.slice(edit.endOffset)}`;
        lastStart = edit.startOffset;
    }

    return nextContent;
}

function positionToOffset(content: string, line: number, character: number): number {
    const normalizedLine = Math.max(1, Math.floor(line));
    const normalizedCharacter = Math.max(1, Math.floor(character));
    const lineStarts = [0];

    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === '\n') {
            lineStarts.push(index + 1);
        }
    }

    const lineIndex = Math.min(normalizedLine - 1, Math.max(0, lineStarts.length - 1));
    const lineStart = lineStarts[lineIndex] ?? 0;
    const nextLineStart = lineIndex + 1 < lineStarts.length
        ? lineStarts[lineIndex + 1]
        : content.length;
    const lineLength = Math.max(0, nextLineStart - lineStart);

    return Math.min(lineStart + normalizedCharacter - 1, lineStart + lineLength);
}

function getLineAndCharacter(
    sourceFile: ts.SourceFile,
    offset: number,
): {
    line: number;
    character: number;
} {
    const location = ts.getLineAndCharacterOfPosition(sourceFile, offset);
    return {
        line: location.line + 1,
        character: location.character + 1,
    };
}

function getLinePreview(sourceFile: ts.SourceFile, offset: number): string {
    const { line } = ts.getLineAndCharacterOfPosition(sourceFile, offset);
    const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
    const lineEnd = line + 1 < sourceFile.getLineStarts().length
        ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
        : sourceFile.text.length;

    return sourceFile.text.slice(lineStart, lineEnd).trim();
}

function discoverWorkspaceFiles(projectRoot: string): string[] {
    const results: string[] = [];

    walk(projectRoot, results);

    return results;
}

function walk(currentPath: string, results: string[]): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            if (SKIPPED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            walk(absolutePath, results);
            continue;
        }

        if (isSupportedSourceFile(absolutePath)) {
            results.push(absolutePath);
        }
    }
}

function isSupportedSourceFile(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function formatDiagnosticMessage(messageText: string | ts.DiagnosticMessageChain): string {
    return ts.flattenDiagnosticMessageText(messageText, '\n');
}

export function clampResultLimit(value: unknown): number {
    const limit = Number(value ?? 20);
    if (!Number.isFinite(limit)) {
        return 20;
    }

    return Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit)));
}

export function clampResolveLimit(value: unknown): number {
    const limit = Number(value ?? 5);
    if (!Number.isFinite(limit)) {
        return 5;
    }

    return Math.max(0, Math.min(10, Math.floor(limit)));
}

export function parseBooleanArg(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}
