import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PDFDocumentProxy, TextContent } from 'pdfjs-dist/types/src/display/api.js';
import type { AnalyzerContext, FileAnalysisDocument, FileAnalysisImage, FileAnalysisResult } from '../types.js';
import { normalizeExtractedText, truncateTextByChars } from '../utils/chunk.js';
import { commandExists, runCommand } from '../utils/command.js';
import { computeSha256 } from '../utils/hash.js';
import { createAnalysisTempDir } from '../utils/temp.js';

type PdfJsModule = typeof import('pdfjs-dist');

const NATIVE_PDF_MAX_BYTES = 20 * 1024 * 1024;
const PDF_INLINE_PAGE_THRESHOLD = 10;
const PDF_RENDER_MAX_BYTES = 100 * 1024 * 1024;
const PDF_RENDER_DPI = 100;

export async function analyzePdf(context: AnalyzerContext): Promise<FileAnalysisResult> {
    const warnings: string[] = [];
    const sha256 = await computeSha256(context.filePath);
    const hasPdfHeader = await readPdfHeader(context.filePath);
    if (!hasPdfHeader) {
        warnings.push('This file does not start with a %PDF- header; native PDF payload preparation was skipped.');
    }

    const documents = hasPdfHeader ? await prepareNativePdfDocument(context, warnings) : [];
    let pageCount = await readPdfPageCount(context, warnings);
    let pageRange = parsePageRange(context.input.pages, context.limits.maxPdfPages, warnings, pageCount);

    if (!pageRange && context.input.mode === 'render') {
        const last = Math.min(pageCount ?? context.limits.maxPdfPages, context.limits.maxPdfPages);
        pageRange = { first: 1, last };
        warnings.push(`No pages parameter was provided for render mode; rendering pages 1-${last}.`);
    }

    if (!context.input.pages?.trim() && pageCount !== undefined && pageCount > PDF_INLINE_PAGE_THRESHOLD) {
        warnings.push(`This PDF has ${pageCount} pages; provide a pages parameter like "1-5" to render a bounded page range.`);
    }

    const shouldRenderPages = pageRange !== undefined && (context.input.mode === 'render' || Boolean(context.input.pages?.trim()));
    const images: FileAnalysisImage[] = [];
    if (shouldRenderPages && pageRange !== undefined) {
        images.push(...await renderPdfPages(context, pageRange, warnings));
    }

    if (!await commandExists('pdftotext', context.env)) {
        warnings.push('pdftotext is not available; install Poppler (macOS: brew install poppler) to extract PDF text.');
        const fallback = await extractPdfTextWithPdfJs(context, pageRange, warnings);
        if (fallback) {
            pageCount ??= fallback.pageCount;
            pageRange = fallback.pageRange;
            warnings.push('Built-in PDF.js text extraction was used because pdftotext is not available.');
            return buildPdfTextResult(context, {
                sha256,
                warnings,
                pageRange,
                pageCount,
                documents,
                images,
                text: fallback.text,
            });
        }

        return buildPdfResult(context, {
            sha256,
            warnings: [
                ...warnings,
                'No PDF text content was extracted. Do not infer or summarize this document from its file name or path alone.',
            ],
            pageRange,
            pageCount,
            documents,
            images,
            content: buildUnavailablePdfContent({
                hasNativeDocument: documents.length > 0,
                hasRenderedImages: images.length > 0,
            }),
        });
    }

    const args = [
        '-layout',
        ...(pageRange ? ['-f', String(pageRange.first), '-l', String(pageRange.last)] : []),
        context.filePath,
        '-',
    ];
    const result = await runCommand('pdftotext', args, {
        env: context.env,
        timeoutMs: context.limits.commandTimeoutMs,
    });

    if (result.exitCode !== 0) {
        warnings.push(`pdftotext failed: ${result.stderr || `exit code ${result.exitCode}`}`);
        const fallback = await extractPdfTextWithPdfJs(context, pageRange, warnings);
        if (fallback) {
            pageCount ??= fallback.pageCount;
            pageRange = fallback.pageRange;
            warnings.push('Built-in PDF.js text extraction was used because pdftotext failed.');
            return buildPdfTextResult(context, {
                sha256,
                warnings,
                pageRange,
                pageCount,
                documents,
                images,
                text: fallback.text,
            });
        }

        return buildPdfResult(context, {
            sha256,
            warnings,
            pageRange,
            pageCount,
            documents,
            images,
            error: result.stderr || `pdftotext exited with ${result.exitCode}`,
        });
    }

    const extracted = normalizeExtractedText(result.stdout);
    if (!extracted.trim()) {
        warnings.push('No text was extracted from this PDF. It may be scanned or image-only; use pages with render mode to inspect page images.');
        warnings.push('Do not infer or summarize this document from its file name or path alone.');
        const fallback = await extractPdfTextWithPdfJs(context, pageRange, warnings);
        if (fallback) {
            pageCount ??= fallback.pageCount;
            pageRange = fallback.pageRange;
            warnings.push('Built-in PDF.js text extraction was used because pdftotext returned no text.');
            return buildPdfTextResult(context, {
                sha256,
                warnings,
                pageRange,
                pageCount,
                documents,
                images,
                text: fallback.text,
            });
        }
    }

    return buildPdfTextResult(context, {
        sha256,
        warnings,
        pageRange,
        pageCount,
        documents,
        images,
        text: extracted,
    });
}

function buildPdfTextResult(
    context: AnalyzerContext,
    input: {
        sha256: string;
        warnings: string[];
        pageRange?: PageRange;
        pageCount?: number;
        documents: FileAnalysisDocument[];
        images: FileAnalysisImage[];
        text: string;
    },
): FileAnalysisResult {
    const truncated = truncateTextByChars(input.text, context.limits.maxTextBytes);
    if (truncated.truncated) {
        input.warnings.push(`PDF text was truncated to ${context.limits.maxTextBytes} characters.`);
    }

    return buildPdfResult(context, {
        sha256: input.sha256,
        warnings: input.warnings,
        pageRange: input.pageRange,
        pageCount: input.pageCount,
        documents: input.documents,
        images: input.images,
        content: truncated.text || buildUnavailablePdfContent({
            hasNativeDocument: input.documents.length > 0,
            hasRenderedImages: input.images.length > 0,
        }),
    });
}

function buildUnavailablePdfContent(input: { hasNativeDocument?: boolean; hasRenderedImages?: boolean } = {}): string {
    const lines = [
        'PDF text content was not extracted.',
    ];
    if (input.hasNativeDocument) {
        lines.push('A native application/pdf payload is available in metadata.analysis.documents for provider adapters that support document inputs.');
    }
    if (input.hasRenderedImages) {
        lines.push('Rendered PDF page images are available in metadata.analysis.images.');
    }
    lines.push('The assistant should report this extraction limitation instead of guessing the document contents from the file name or path.');
    return lines.join('\n');
}

function buildPdfResult(
    context: AnalyzerContext,
    input: {
        sha256: string;
        warnings?: string[];
        pageRange?: PageRange;
        pageCount?: number;
        documents?: FileAnalysisDocument[];
        images?: FileAnalysisImage[];
        content?: string;
        error?: string;
    },
): FileAnalysisResult {
    const result: FileAnalysisResult = {
        ok: true,
        path: context.filePath,
        fileName: path.basename(context.filePath),
        size: context.stat.size,
        ext: context.detected.ext,
        mime: context.detected.mime ?? 'application/pdf',
        kind: 'pdf',
        content: input.content,
        metadata: {
            sha256: input.sha256,
            ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
            ...(input.pageRange ? { pages: `${input.pageRange.first}-${input.pageRange.last}` } : {}),
            ...(input.documents?.length ? { nativePdf: { mime: 'application/pdf', size: input.documents[0]?.size, available: true } } : {}),
            ...(input.images?.length ? { renderedPages: input.images.map((image) => image.page).filter((page) => page !== undefined) } : {}),
        },
        warnings: input.warnings && input.warnings.length > 0 ? input.warnings : undefined,
        error: input.error,
    };
    if (input.documents?.length) {
        result.documents = input.documents;
    }
    if (input.images?.length) {
        result.images = input.images;
    }
    return result;
}

interface PageRange {
    first: number;
    last: number;
}

async function readPdfHeader(filePath: string): Promise<boolean> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(5);
        await handle.read(buffer, 0, buffer.length, 0);
        return buffer.toString('latin1') === '%PDF-';
    } finally {
        await handle.close();
    }
}

async function prepareNativePdfDocument(
    context: AnalyzerContext,
    warnings: string[],
): Promise<FileAnalysisDocument[]> {
    if (context.stat.size > NATIVE_PDF_MAX_BYTES) {
        warnings.push(`Native PDF payload was skipped because the file is larger than ${NATIVE_PDF_MAX_BYTES} bytes.`);
        return [];
    }

    const bytes = await fs.readFile(context.filePath);
    return [{
        mime: 'application/pdf',
        base64: bytes.toString('base64'),
        size: bytes.byteLength,
    }];
}

interface PdfJsTextExtraction {
    text: string;
    pageCount: number;
    pageRange: PageRange;
}

async function extractPdfTextWithPdfJs(
    context: AnalyzerContext,
    pageRange: PageRange | undefined,
    warnings: string[],
): Promise<PdfJsTextExtraction | undefined> {
    let document: PDFDocumentProxy | undefined;
    try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfJsModule;
        const bytes = await fs.readFile(context.filePath);
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(bytes),
            disableFontFace: true,
            isEvalSupported: false,
            useWorkerFetch: false,
            verbosity: pdfjs.VerbosityLevel.ERRORS,
        });
        document = await loadingTask.promise;
        const resolvedRange = resolvePdfJsPageRange(pageRange, document.numPages, context.limits.maxPdfPages, warnings);
        const pages: Array<{ page: number; text: string }> = [];
        for (let pageNumber = resolvedRange.first; pageNumber <= resolvedRange.last; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const text = normalizeExtractedText(renderPdfJsTextContent(textContent));
            if (text) {
                pages.push({ page: pageNumber, text });
            }
            page.cleanup();
        }
        const text = normalizeExtractedText(renderPdfJsPages(pages));
        if (!text.trim()) {
            warnings.push('Built-in PDF.js text extraction did not find selectable text.');
            return undefined;
        }
        return {
            text,
            pageCount: document.numPages,
            pageRange: resolvedRange,
        };
    } catch (error) {
        warnings.push(`Built-in PDF.js text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    } finally {
        await document?.destroy();
    }
}

function resolvePdfJsPageRange(
    pageRange: PageRange | undefined,
    pageCount: number,
    maxPages: number,
    warnings: string[],
): PageRange {
    if (pageRange) {
        const last = Math.min(pageRange.last, pageCount);
        if (last < pageRange.last) {
            warnings.push(`PDF.js text extraction was limited to ${pageCount} available pages (${pageRange.first}-${last}).`);
        }
        return { first: pageRange.first, last: Math.max(pageRange.first, last) };
    }

    const last = Math.min(pageCount, maxPages);
    if (pageCount > maxPages) {
        warnings.push(`Built-in PDF.js text extraction was limited to the first ${maxPages} pages; provide pages like "1-5" for a specific range.`);
    }
    return { first: 1, last };
}

function renderPdfJsPages(pages: Array<{ page: number; text: string }>): string {
    if (pages.length === 1) {
        return pages[0]?.text ?? '';
    }
    return pages.map((page) => `--- Page ${page.page} ---\n${page.text}`).join('\n\n');
}

function renderPdfJsTextContent(textContent: TextContent): string {
    const parts: string[] = [];
    for (const item of textContent.items) {
        if (!('str' in item)) {
            continue;
        }
        parts.push(item.str);
        if (item.hasEOL) {
            parts.push('\n');
        }
    }
    return parts.join('');
}

async function readPdfPageCount(
    context: AnalyzerContext,
    warnings: string[],
): Promise<number | undefined> {
    if (!await commandExists('pdfinfo', context.env)) {
        return undefined;
    }

    const result = await runCommand('pdfinfo', [context.filePath], {
        env: context.env,
        timeoutMs: context.limits.commandTimeoutMs,
    });
    if (result.exitCode !== 0) {
        warnings.push(`pdfinfo failed: ${result.stderr || `exit code ${result.exitCode}`}`);
        return undefined;
    }

    const match = /^Pages:\s*(\d+)\s*$/mi.exec(result.stdout);
    if (!match) {
        warnings.push('pdfinfo did not report a page count.');
        return undefined;
    }

    return Number(match[1]);
}

async function renderPdfPages(
    context: AnalyzerContext,
    pageRange: PageRange,
    warnings: string[],
): Promise<FileAnalysisImage[]> {
    if (context.stat.size > PDF_RENDER_MAX_BYTES) {
        warnings.push(`PDF page rendering was skipped because the file is larger than ${PDF_RENDER_MAX_BYTES} bytes.`);
        return [];
    }

    if (!await commandExists('pdftoppm', context.env)) {
        warnings.push('pdftoppm is not available; install Poppler (macOS: brew install poppler) to render PDF pages.');
        return [];
    }

    const outputDir = await createAnalysisTempDir(path.basename(context.filePath));
    const outputPrefix = path.join(outputDir, 'page');
    const result = await runCommand('pdftoppm', [
        '-jpeg',
        '-r',
        String(PDF_RENDER_DPI),
        '-f',
        String(pageRange.first),
        '-l',
        String(pageRange.last),
        context.filePath,
        outputPrefix,
    ], {
        env: context.env,
        timeoutMs: context.limits.commandTimeoutMs,
    });

    if (result.exitCode !== 0) {
        warnings.push(`pdftoppm failed: ${result.stderr || `exit code ${result.exitCode}`}`);
        return [];
    }

    const files = (await fs.readdir(outputDir))
        .filter((fileName) => /\.jpe?g$/i.test(fileName))
        .sort(compareRenderedPageFiles);

    if (files.length === 0) {
        warnings.push('pdftoppm completed but did not produce any JPEG page images.');
        return [];
    }

    const images: FileAnalysisImage[] = [];
    for (const fileName of files) {
        const imagePath = path.join(outputDir, fileName);
        const bytes = await fs.readFile(imagePath);
        const page = readRenderedPageNumber(fileName);
        images.push({
            ...(page !== undefined ? { page } : {}),
            mime: 'image/jpeg',
            base64: bytes.toString('base64'),
            path: imagePath,
        });
    }

    return images;
}

function compareRenderedPageFiles(left: string, right: string): number {
    const leftPage = readRenderedPageNumber(left);
    const rightPage = readRenderedPageNumber(right);
    if (leftPage !== undefined && rightPage !== undefined) {
        return leftPage - rightPage;
    }
    return left.localeCompare(right);
}

function readRenderedPageNumber(fileName: string): number | undefined {
    const match = /-(\d+)\.jpe?g$/i.exec(fileName);
    return match ? Number(match[1]) : undefined;
}

function parsePageRange(
    value: string | undefined,
    maxPages: number,
    warnings: string[],
    pageCount?: number,
): PageRange | undefined {
    if (!value?.trim()) {
        return undefined;
    }

    const firstSegment = value.split(',')[0]?.trim() ?? '';
    if (value.includes(',')) {
        warnings.push(`Only the first PDF page range is supported in V1; using "${firstSegment}".`);
    }

    const match = /^(\d+)(?:-(\d*))?$/.exec(firstSegment);
    if (!match) {
        warnings.push(`Invalid pages value "${value}"; expected a range like "1-5". Reading the PDF without a page filter.`);
        return undefined;
    }

    const first = Math.max(1, Number(match[1]));
    if (pageCount !== undefined && first > pageCount) {
        warnings.push(`Page range starts at ${first}, but pdfinfo reports only ${pageCount} pages.`);
        return undefined;
    }
    const hasOpenRange = firstSegment.endsWith('-');
    const hasRangeEnd = match[2] !== undefined && match[2] !== '';
    const requestedLast = hasOpenRange
        ? first + maxPages - 1
        : Math.max(first, hasRangeEnd ? Number(match[2]) : first);
    const allowedLast = first + maxPages - 1;
    const last = Math.min(requestedLast, allowedLast, pageCount ?? requestedLast);
    if (last < requestedLast) {
        const reason = pageCount !== undefined && pageCount < requestedLast ? `${pageCount} available pages` : `${maxPages} pages`;
        warnings.push(`Page range was limited to ${reason} (${first}-${last}).`);
    }

    return { first, last };
}
