import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    appendEditorAttachment,
    buildAttachmentPromptText,
    buildMessageAttachments,
    MAX_EDITOR_ATTACHMENTS,
} from '../../../src/application/chat/attachments.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('chat attachment helpers', () => {
    it('deduplicates attachments and enforces the editor limit', () => {
        const cwd = createTempDir();
        const existing = Array.from({ length: MAX_EDITOR_ATTACHMENTS }, (_, index) => path.join(cwd, `${index}.txt`));

        const duplicate = appendEditorAttachment([existing[0]!], existing[0]!);
        expect(duplicate.status).toBe('duplicate');
        expect(duplicate.attachments).toEqual([existing[0]]);

        const limited = appendEditorAttachment(existing, path.join(cwd, 'extra.txt'));
        expect(limited.status).toBe('limit');
        expect(limited.attachments).toEqual(existing);
    });

    it('builds prompt text with relative in-project paths and absolute out-of-project paths', () => {
        const cwd = createTempDir();
        const inside = path.join(cwd, 'docs', 'guide.md');
        const outside = path.join(os.tmpdir(), 'outside-guide.md');

        const prompt = buildAttachmentPromptText('Explain this', [inside, outside], cwd);

        expect(prompt).toContain('- docs/guide.md');
        expect(prompt).toContain(`- ${path.resolve(outside)}`);
        expect(prompt).toContain('[AttachedFiles]');
    });

    it('creates attachment payloads and reports missing files', () => {
        const cwd = createTempDir();
        const textFile = path.join(cwd, 'notes.txt');
        const imageFile = path.join(cwd, 'diagram.png');
        const missingFile = path.join(cwd, 'missing.txt');

        fs.writeFileSync(textFile, 'hello', 'utf-8');
        fs.writeFileSync(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

        const { attachments, issues } = buildMessageAttachments([textFile, imageFile, missingFile]);

        expect(attachments).toHaveLength(2);
        expect(attachments.map((attachment) => attachment.type)).toEqual(['file', 'image']);
        expect(issues).toEqual([{ filePath: path.resolve(missingFile), reason: 'missing' }]);
    });

    it('assigns the docx attachment MIME type for file attachments', () => {
        const cwd = createTempDir();
        const docxFile = path.join(cwd, 'report.docx');
        fs.writeFileSync(docxFile, 'placeholder', 'utf-8');

        const { attachments, issues } = buildMessageAttachments([docxFile]);

        expect(issues).toEqual([]);
        expect(attachments).toHaveLength(1);
        expect(attachments[0]).toMatchObject({
            type: 'file',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            filePath: path.resolve(docxFile),
            fileName: 'report.docx',
        });
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-attachments-'));
    tempDirs.push(dir);
    return dir;
}
