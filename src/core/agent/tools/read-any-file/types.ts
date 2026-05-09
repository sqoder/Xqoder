import type * as fs from 'node:fs';

export type FileKind =
    | 'text'
    | 'code'
    | 'pdf'
    | 'document'
    | 'spreadsheet'
    | 'presentation'
    | 'image'
    | 'video'
    | 'audio'
    | 'archive'
    | 'database'
    | 'executable'
    | 'binary'
    | 'unknown';

export type ReadAnyFileMode = 'auto' | 'text' | 'metadata' | 'raw' | 'render' | 'ocr';

export interface ReadAnyFileInput {
    path: string;
    pages?: string;
    timestamps?: string;
    mode?: ReadAnyFileMode;
    maxBytes?: number;
    maxPages?: number;
    maxFrames?: number;
    maxDepth?: number;
}

export interface FileAnalysisImage {
    page?: number;
    timestamp?: number;
    mime: string;
    base64?: string;
    path?: string;
}

export interface FileAnalysisDocument {
    mime: string;
    base64?: string;
    path?: string;
    size: number;
}

export interface FileAnalysisChild {
    path: string;
    size?: number;
    kind?: string;
    mime?: string;
}

export interface FileAnalysisResult {
    ok: boolean;
    path: string;
    fileName: string;
    size: number;
    ext?: string;
    mime?: string;
    kind: FileKind;
    content?: string;
    summary?: string;
    transcript?: string;
    metadata?: Record<string, unknown>;
    documents?: FileAnalysisDocument[];
    images?: FileAnalysisImage[];
    children?: FileAnalysisChild[];
    warnings?: string[];
    error?: string;
}

export interface DetectedFile {
    kind: FileKind;
    ext?: string;
    mime?: string;
    encoding?: string;
    source?: 'magic' | 'extension' | 'text' | 'content' | 'fallback';
}

export interface AnalysisLimits {
    maxBytes: number;
    maxTextBytes: number;
    maxPdfPages: number;
    maxFrames: number;
    maxArchiveFiles: number;
    maxArchiveDepth: number;
    commandTimeoutMs: number;
}

export interface AnalyzerContext {
    input: ReadAnyFileInput;
    filePath: string;
    stat: fs.Stats;
    detected: DetectedFile;
    limits: AnalysisLimits;
    env?: Record<string, string>;
}

export interface ReadAnyFileRuntimeContext {
    env?: Record<string, string>;
}
