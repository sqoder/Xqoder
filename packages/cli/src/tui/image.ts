// ============================================================
// 终端图片渲染器 — Unicode 半块字符 (▀) 实现
// 参考 OpenCode: internal/tui/image/images.go
// ============================================================

import * as fs from 'node:fs';
import chalk from 'chalk';

const UPPER_HALF_BLOCK = '▀';

const SUPPORTED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif',
]);

export function isSupportedImageExt(filePath: string): boolean {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
}

export function validateFileSize(filePath: string, sizeLimitBytes: number): boolean {
    try {
        const stat = fs.statSync(filePath);
        return stat.size <= sizeLimitBytes;
    } catch {
        return false;
    }
}

/**
 * Decode a PNG file into raw RGBA pixel data using pure Node.js (no native deps).
 * Supports PNG only (the most common terminal-preview format).
 * For JPG/WEBP, returns null — caller should show a placeholder.
 */
function decodePng(buffer: Buffer): { width: number; height: number; data: Uint8Array } | null {
    // PNG signature check
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4E || buffer[3] !== 0x47) {
        return null;
    }

    // Minimal PNG decoder for IHDR + IDAT
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const compressedChunks: Buffer[] = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8]!;
            colorType = data[9]!;
        } else if (type === 'IDAT') {
            compressedChunks.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }

        offset += 12 + length;
    }

    if (width === 0 || height === 0 || compressedChunks.length === 0) return null;
    if (bitDepth !== 8) return null; // only support 8-bit

    const { inflateSync } = require('node:zlib') as typeof import('node:zlib');
    const compressed = Buffer.concat(compressedChunks);
    let raw: Buffer;
    try {
        raw = inflateSync(compressed);
    } catch {
        return null;
    }

    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
    const scanlineBytes = width * channels + 1; // +1 for filter byte
    const pixels = new Uint8Array(width * height * 4);

    const prevRow = new Uint8Array(width * channels);
    const currRow = new Uint8Array(width * channels);

    for (let y = 0; y < height; y++) {
        const rowStart = y * scanlineBytes;
        const filterType = raw[rowStart]!;
        const rowData = raw.subarray(rowStart + 1, rowStart + 1 + width * channels);

        // Apply PNG filter
        for (let i = 0; i < width * channels; i++) {
            const a = i >= channels ? currRow[i - channels]! : 0;
            const b = prevRow[i]!;
            const c = i >= channels ? prevRow[i - channels]! : 0;
            const x = rowData[i]!;

            switch (filterType) {
                case 0: currRow[i] = x; break;
                case 1: currRow[i] = (x + a) & 0xFF; break;
                case 2: currRow[i] = (x + b) & 0xFF; break;
                case 3: currRow[i] = (x + ((a + b) >> 1)) & 0xFF; break;
                case 4: currRow[i] = (x + paethPredictor(a, b, c)) & 0xFF; break;
                default: currRow[i] = x;
            }
        }

        for (let x = 0; x < width; x++) {
            const pi = (y * width + x) * 4;
            if (channels === 4) {
                pixels[pi] = currRow[x * 4]!;
                pixels[pi + 1] = currRow[x * 4 + 1]!;
                pixels[pi + 2] = currRow[x * 4 + 2]!;
                pixels[pi + 3] = currRow[x * 4 + 3]!;
            } else if (channels === 3) {
                pixels[pi] = currRow[x * 3]!;
                pixels[pi + 1] = currRow[x * 3 + 1]!;
                pixels[pi + 2] = currRow[x * 3 + 2]!;
                pixels[pi + 3] = 255;
            } else {
                pixels[pi] = pixels[pi + 1] = pixels[pi + 2] = currRow[x]!;
                pixels[pi + 3] = 255;
            }
        }

        prevRow.set(currRow);
    }

    return { width, height, data: pixels };
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

interface PixelImage {
    width: number;
    height: number;
    getPixel(x: number, y: number): [number, number, number];
}

function resizeNearest(img: PixelImage, targetWidth: number): PixelImage {
    const ratio = targetWidth / img.width;
    const targetHeight = Math.round(img.height * ratio);
    return {
        width: targetWidth,
        height: targetHeight,
        getPixel(x: number, y: number) {
            const srcX = Math.min(Math.floor(x / ratio), img.width - 1);
            const srcY = Math.min(Math.floor(y / ratio), img.height - 1);
            return img.getPixel(srcX, srcY);
        },
    };
}

/**
 * Render a PNG image to ANSI terminal output using Unicode half-block characters.
 * Each character represents two vertically stacked pixels:
 * - Top pixel → foreground color
 * - Bottom pixel → background color
 */
export function imageToAnsi(filePath: string, maxWidth: number): string | null {
    if (!isSupportedImageExt(filePath)) return null;
    if (!validateFileSize(filePath, 10 * 1024 * 1024)) return null;

    let buffer: Buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch {
        return null;
    }

    const decoded = decodePng(buffer);
    if (!decoded) {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        return `  🖼  [${ext.toUpperCase().slice(1)} image — PNG preview only]`;
    }

    const baseImg: PixelImage = {
        width: decoded.width,
        height: decoded.height,
        getPixel(x, y) {
            const i = (y * decoded.width + x) * 4;
            return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
        },
    };

    const displayWidth = Math.min(maxWidth, decoded.width);
    const img = displayWidth < decoded.width ? resizeNearest(baseImg, displayWidth) : baseImg;
    const lines: string[] = [];

    for (let y = 0; y < img.height; y += 2) {
        let line = '';
        for (let x = 0; x < img.width; x++) {
            const [r1, g1, b1] = img.getPixel(x, y);
            const [r2, g2, b2] = y + 1 < img.height
                ? img.getPixel(x, y + 1)
                : [r1, g1, b1];
            line += chalk.rgb(r1, g1, b1).bgRgb(r2, g2, b2)(UPPER_HALF_BLOCK);
        }
        lines.push(line);
    }

    return lines.join('\n');
}

/**
 * Generate a compact image preview string for display in file pickers / message areas.
 */
export function imagePreview(filePath: string, maxWidth = 60): string {
    const result = imageToAnsi(filePath, maxWidth);
    if (result) return result;
    return `  🖼  [Image: ${filePath.split('/').pop() ?? filePath}]`;
}
