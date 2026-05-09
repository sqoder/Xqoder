import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';

export async function computeSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const handle = await fs.open(filePath, 'r');
    try {
        for await (const chunk of handle.readableWebStream() as unknown as AsyncIterable<Buffer>) {
            hash.update(Buffer.from(chunk));
        }
        return hash.digest('hex');
    } finally {
        await handle.close();
    }
}

export async function readHeadBuffer(filePath: string, maxBytes: number): Promise<Buffer> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(maxBytes);
        const result = await handle.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, result.bytesRead);
    } finally {
        await handle.close();
    }
}

export function formatHexPreview(buffer: Buffer, bytesPerLine = 16): string {
    const lines: string[] = [];
    for (let offset = 0; offset < buffer.length; offset += bytesPerLine) {
        const slice = buffer.subarray(offset, offset + bytesPerLine);
        const hex = Array.from(slice)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(' ');
        const ascii = Array.from(slice)
            .map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')
            .join('');
        lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(bytesPerLine * 3 - 1)}  |${ascii}|`);
    }
    return lines.join('\n');
}

export function extractPrintableStrings(buffer: Buffer, minLength = 4, maxStrings = 80): string[] {
    const strings: string[] = [];
    let current = '';

    for (const byte of buffer) {
        if (byte >= 32 && byte <= 126) {
            current += String.fromCharCode(byte);
            continue;
        }

        if (current.length >= minLength) {
            strings.push(current);
            if (strings.length >= maxStrings) {
                return strings;
            }
        }
        current = '';
    }

    if (current.length >= minLength && strings.length < maxStrings) {
        strings.push(current);
    }

    return strings;
}
