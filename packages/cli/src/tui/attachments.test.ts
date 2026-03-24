import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEditorAttachment, buildAttachmentPromptText, buildMessageAttachments, formatAttachmentDisplayLabel, MAX_BINARY_ATTACHMENT_BYTES, MAX_EDITOR_ATTACHMENTS } from './attachments.js';

const tempDirs: string[] = [];

function mkTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-attachments-test-'));
    tempDirs.push(dir);
    return dir;
}

describe('tui attachment helpers', () => {
    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (!dir) continue;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('formats attachment labels without the legacy @ prefix', () => {
        expect(formatAttachmentDisplayLabel('/tmp/readme.md')).toBe('readme.md');
        expect(formatAttachmentDisplayLabel('/tmp/model-config.ts')).toBe('model-c...');
    });

    it('deduplicates normalized attachment paths', () => {
        const first = appendEditorAttachment([], '/tmp/demo.txt');
        const second = appendEditorAttachment(first.attachments, '/tmp/./demo.txt');

        expect(first.status).toBe('added');
        expect(second).toEqual({
            attachments: ['/tmp/demo.txt'],
            status: 'duplicate',
        });
    });

    it('caps editor attachments at the OpenCode-like limit', () => {
        const attachments = Array.from({ length: MAX_EDITOR_ATTACHMENTS }, (_, index) => `/tmp/file-${index}.txt`);
        expect(appendEditorAttachment(attachments, '/tmp/overflow.txt').status).toBe('limit');
    });

    it('builds an attachment prompt block with project-relative paths when possible', () => {
        expect(buildAttachmentPromptText('please review this', [
            '/repo/src/app.ts',
            '/Users/demo/Desktop/note.txt',
        ], '/repo')).toBe([
            'please review this',
            '',
            '[AttachedFiles]',
            'The user attached these files to this request:',
            '- src/app.ts',
            '- /Users/demo/Desktop/note.txt',
            'Treat them as part of the request context and read them directly when needed.',
            '[/AttachedFiles]',
        ].join('\n'));
    });

    it('loads image attachments as binary message attachments and keeps files as path references', () => {
        const dir = mkTmpDir();
        const imagePath = path.join(dir, 'diagram.png');
        const filePath = path.join(dir, 'notes.txt');
        fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary');
        fs.writeFileSync(filePath, 'hello', 'utf8');

        expect(buildMessageAttachments([imagePath, filePath])).toEqual({
            attachments: [
                {
                    kind: 'image',
                    type: 'image',
                    mimeType: 'image/png',
                    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
                    filePath: imagePath,
                    fileName: 'diagram.png',
                },
                {
                    kind: 'file',
                    type: 'file',
                    mimeType: 'application/octet-stream',
                    filePath,
                    fileName: 'notes.txt',
                },
            ],
            issues: [],
        });
    });

    it('drops oversized binary attachments with a clear issue reason', () => {
        const dir = mkTmpDir();
        const imagePath = path.join(dir, 'huge.png');
        fs.writeFileSync(imagePath, Buffer.alloc(MAX_BINARY_ATTACHMENT_BYTES + 1, 1));

        expect(buildMessageAttachments([imagePath])).toEqual({
            attachments: [],
            issues: [
                {
                    filePath: imagePath,
                    reason: 'too_large',
                },
            ],
        });
    });
});
