import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detect as detectEncoding } from 'chardet';
import { fileTypeFromFile } from 'file-type';
import type { DetectedFile, FileKind } from './types.js';

const CODE_EXTENSIONS = new Set([
    'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'jsx',
    'json', 'jsonl', 'kt', 'lua', 'mjs', 'php', 'py', 'rb', 'rs', 'sh', 'sql',
    'swift', 'ts', 'tsx', 'vue', 'xml',
]);
const TEXT_EXTENSIONS = new Set([
    'conf', 'csv', 'env', 'ini', 'log', 'md', 'properties', 'rst', 'text', 'toml',
    'tsv', 'txt', 'yaml', 'yml',
]);
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'rtf', 'epub']);
const SPREADSHEET_EXTENSIONS = new Set(['xls', 'xlsx', 'ods']);
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'odp']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'xz', 'bz2']);
const DATABASE_EXTENSIONS = new Set(['db', 'sqlite', 'sqlite3']);
const EXECUTABLE_EXTENSIONS = new Set(['exe', 'dll', 'so', 'dylib', 'wasm', 'apk', 'ipa', 'dmg', 'iso']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg']);

export async function detectFile(filePath: string): Promise<DetectedFile> {
    const ext = normalizeExt(path.extname(filePath));
    const extensionMatch = normalizeExtension(ext);
    const sample = await readSample(filePath);
    const encoding = detectEncoding(sample) ?? undefined;

    if (isSqlite(sample)) {
        return withEncoding({ kind: 'database', ext, mime: 'application/vnd.sqlite3', source: 'content' }, encoding);
    }

    if (extensionMatch && isOfficeKind(extensionMatch.kind)) {
        return withEncoding(extensionMatch, encoding);
    }

    const magic = await fileTypeFromFile(filePath).catch((): undefined => undefined);
    if (magic) {
        return withEncoding(normalizeMagic(magic.ext, magic.mime, ext, extensionMatch), encoding);
    }

    if (extensionMatch) {
        return withEncoding(extensionMatch, encoding);
    }

    if (looksLikeTextBuffer(sample)) {
        return withEncoding({ kind: 'text', ext, mime: 'text/plain', source: 'text' }, encoding);
    }

    return { kind: 'binary', ext, mime: 'application/octet-stream', source: 'fallback' };
}

export function shouldUseReadAnyForLegacyRead(detected: DetectedFile, filePath: string): boolean {
    if (detected.kind === 'text' || detected.kind === 'code') {
        return false;
    }

    return path.extname(filePath).toLowerCase() !== '.docx';
}

function normalizeMagic(
    magicExt: string,
    mime: string,
    originalExt: string | undefined,
    extensionMatch: DetectedFile | undefined,
): DetectedFile {
    if (extensionMatch && isOfficeKind(extensionMatch.kind)) {
        return { ...extensionMatch, mime };
    }

    if (mime === 'application/pdf' || magicExt === 'pdf') {
        return { kind: 'pdf', ext: originalExt ?? magicExt, mime, source: 'magic' };
    }
    if (mime.startsWith('image/')) {
        return { kind: 'image', ext: originalExt ?? magicExt, mime, source: 'magic' };
    }
    if (mime.startsWith('video/')) {
        return { kind: 'video', ext: originalExt ?? magicExt, mime, source: 'magic' };
    }
    if (mime.startsWith('audio/')) {
        return { kind: 'audio', ext: originalExt ?? magicExt, mime, source: 'magic' };
    }
    if (ARCHIVE_EXTENSIONS.has(magicExt)) {
        return { kind: 'archive', ext: originalExt ?? magicExt, mime, source: 'magic' };
    }

    return extensionMatch ?? { kind: 'binary', ext: originalExt ?? magicExt, mime, source: 'magic' };
}

function normalizeExtension(ext: string | undefined): DetectedFile | undefined {
    if (!ext) {
        return undefined;
    }

    if (ext === 'pdf') {
        return { kind: 'pdf', ext, mime: 'application/pdf', source: 'extension' };
    }
    if (CODE_EXTENSIONS.has(ext)) {
        return { kind: 'code', ext, mime: mimeForTextExt(ext), source: 'extension' };
    }
    if (TEXT_EXTENSIONS.has(ext)) {
        return { kind: 'text', ext, mime: mimeForTextExt(ext), source: 'extension' };
    }
    if (DOCUMENT_EXTENSIONS.has(ext)) {
        return { kind: 'document', ext, mime: mimeForOfficeExt(ext), source: 'extension' };
    }
    if (SPREADSHEET_EXTENSIONS.has(ext)) {
        return { kind: 'spreadsheet', ext, mime: mimeForOfficeExt(ext), source: 'extension' };
    }
    if (PRESENTATION_EXTENSIONS.has(ext)) {
        return { kind: 'presentation', ext, mime: mimeForOfficeExt(ext), source: 'extension' };
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
        return { kind: 'image', ext, mime: ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`, source: 'extension' };
    }
    if (VIDEO_EXTENSIONS.has(ext)) {
        return { kind: 'video', ext, mime: `video/${ext}`, source: 'extension' };
    }
    if (AUDIO_EXTENSIONS.has(ext)) {
        return { kind: 'audio', ext, mime: `audio/${ext}`, source: 'extension' };
    }
    if (ARCHIVE_EXTENSIONS.has(ext)) {
        return { kind: 'archive', ext, mime: 'application/octet-stream', source: 'extension' };
    }
    if (DATABASE_EXTENSIONS.has(ext)) {
        return { kind: 'database', ext, mime: 'application/vnd.sqlite3', source: 'extension' };
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
        return { kind: 'executable', ext, mime: 'application/octet-stream', source: 'extension' };
    }

    return undefined;
}

function mimeForTextExt(ext: string): string {
    if (ext === 'json' || ext === 'jsonl') {
        return 'application/json';
    }
    if (ext === 'html') {
        return 'text/html';
    }
    if (ext === 'xml') {
        return 'application/xml';
    }
    if (ext === 'csv') {
        return 'text/csv';
    }
    return 'text/plain';
}

function mimeForOfficeExt(ext: string): string {
    switch (ext) {
        case 'docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'xlsx':
            return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case 'pptx':
            return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        default:
            return 'application/octet-stream';
    }
}

function isOfficeKind(kind: FileKind): boolean {
    return kind === 'document' || kind === 'spreadsheet' || kind === 'presentation';
}

function withEncoding(detected: DetectedFile, encoding: string | undefined): DetectedFile {
    return encoding ? { ...detected, encoding } : detected;
}

async function readSample(filePath: string): Promise<Buffer> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(8192);
        const result = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, result.bytesRead);
    } finally {
        await handle.close();
    }
}

function isSqlite(sample: Buffer): boolean {
    return sample.subarray(0, 16).toString('utf-8') === 'SQLite format 3\0';
}

function normalizeExt(value: string): string | undefined {
    const normalized = value.replace(/^\./, '').toLowerCase();
    return normalized || undefined;
}

function looksLikeTextBuffer(sample: Buffer): boolean {
    if (sample.length === 0) {
        return true;
    }
    let suspicious = 0;
    for (const byte of sample) {
        if (byte === 0) {
            return false;
        }
        const isCommonTextByte = byte === 9 || byte === 10 || byte === 12 || byte === 13 || (byte >= 32 && byte !== 127);
        if (!isCommonTextByte) {
            suspicious += 1;
        }
    }
    return suspicious / sample.length < 0.05;
}
