import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    FileSessionShareStore,
    formatSessionShareDetail,
    formatSessionShareListLine,
} from '../../../src/features/sessions/assets.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('session share store usage roundtrip', () => {
    it('persists usage in share metadata and exposes it through list/get/detail formatting', () => {
        const rootDir = createTempDir();
        const store = new FileSessionShareStore(rootDir);

        const created = store.createShare({
            sessionId: 'session-share-store',
            projectRoot: '/workspace/demo',
            title: 'Share Store Usage',
            format: 'markdown',
            content: '# share\n\nUsage visible.',
            usage: {
                promptTokens: 21,
                completionTokens: 5,
                totalTokens: 26,
                cacheReadTokens: 8,
                cacheCreationTokens: 3,
                cost: 0.45,
            },
        });
        const listed = store.listShares('/workspace/demo', 10);
        const loaded = store.getShare(created.id);

        expect(created.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(listed[0]?.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(loaded?.usage).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
            cacheReadTokens: 8,
            cacheCreationTokens: 3,
            cost: 0.45,
        });
        expect(formatSessionShareListLine(listed[0]!)).toContain('tokens=26');
        expect(formatSessionShareListLine(listed[0]!)).toContain('cost=$0.45');
        expect(formatSessionShareDetail(loaded!)).toContain(
            'Usage: prompt=21, completion=5, total=26, cacheRead=8, cacheCreate=3, cost=$0.45',
        );
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-share-store-'));
    tempDirs.push(dir);
    return dir;
}
