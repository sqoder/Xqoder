import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CopySelectionController } from './copy-selection-controller.js';

const mocked = vi.hoisted(() => ({
    writeText: vi.fn(async () => undefined),
    writeToClipboardOSC52: vi.fn(),
    copyTarget: vi.fn(async () => undefined),
    copyViewportSelection: vi.fn(() => false),
    resolveViewportCopyTarget: vi.fn(() => ({ kind: 'code-block', blockId: 'b1' })),
}));

vi.mock('../terminal-core/clipboard.js', () => ({
    getClipboardService: () => ({ writeText: mocked.writeText }),
    writeToClipboardOSC52: mocked.writeToClipboardOSC52,
}));

vi.mock('../terminal-core/copy-action.js', () => ({
    copyTarget: mocked.copyTarget,
    copyViewportSelection: mocked.copyViewportSelection,
    resolveViewportCopyTarget: mocked.resolveViewportCopyTarget,
}));

describe('CopySelectionController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns false for unrelated input', () => {
        const controller = new CopySelectionController({
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: () => undefined,
            stdout: process.stdout,
        });

        const handled = controller.handle({ type: 'key', key: 'x', raw: '' }, { viewport: {}, transcriptLines: [] }, '/tmp');
        expect(handled).toBe(false);
    });

    it('copies selected text on alt+c and clears selection', async () => {
        mocked.copyViewportSelection.mockReturnValueOnce(true);
        const controller = new CopySelectionController({
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: () => undefined,
            stdout: process.stdout,
        });

        const handled = controller.handle(
            { type: 'key', key: 'c', alt: true, raw: '' },
            { viewport: { selectedRange: { start: { line: 0, column: 0 }, end: { line: 0, column: 3 } } }, transcriptLines: ['abc'] },
            '/tmp',
        );

        expect(handled).toBe(true);
        expect(mocked.copyViewportSelection).toHaveBeenCalledWith(
            ['abc'],
            { start: { line: 0, column: 0 }, end: { line: 0, column: 3 } },
            expect.anything(),
            expect.any(Function),
            expect.any(Function),
            process.stdout,
            { ttl: 5000, clearSelectionOnEmpty: false },
        );
        expect(mocked.resolveViewportCopyTarget).not.toHaveBeenCalled();
    });

    it('handles selected empty text without copy target fallback', () => {
        mocked.copyViewportSelection.mockReturnValueOnce(true);
        const controller = new CopySelectionController({
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: () => undefined,
            stdout: process.stdout,
        });

        const handled = controller.handle(
            { type: 'key', key: 'y', raw: '' },
            { viewport: { selectedRange: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } } }, transcriptLines: [''] },
            '/tmp',
        );

        expect(handled).toBe(true);
        expect(mocked.copyViewportSelection).toHaveBeenCalled();
        expect(mocked.copyTarget).not.toHaveBeenCalled();
    });

    it('copies patched path on y and posts notice', async () => {
        const dispatch = vi.fn();
        const controller = new CopySelectionController({
            dispatch,
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: (line) => (line.includes('Patched') ? 'src/a.ts' : undefined),
            stdout: process.stdout,
        });

        const handled = controller.handle(
            { type: 'key', key: 'y', raw: '' },
            {
                cwd: '/repo',
                viewport: { anchorMessageId: 0 },
                transcriptLines: ['Patched src/a.ts (+1 -0)'],
            },
            '/repo',
        );

        expect(handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'notice.set', notice: 'Copied path: src/a.ts' });
        await Promise.resolve();
        expect(mocked.writeText).toHaveBeenCalled();
    });

    it('prefers the focused copy target over the first visible code block on alt+c', async () => {
        mocked.resolveViewportCopyTarget.mockReturnValueOnce({ kind: 'message', messageId: 'm-focus' } as any);
        const controller = new CopySelectionController({
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: () => undefined,
            stdout: process.stdout,
        });

        const handled = controller.handle(
            { type: 'key', key: 'c', alt: true, raw: '' },
            {
                viewport: { anchorMessageId: 3 },
                transcriptLines: ['a', 'b', 'c', 'd'],
            },
            '/tmp',
        );

        expect(handled).toBe(true);
        expect(mocked.resolveViewportCopyTarget).toHaveBeenCalledWith(expect.anything(), 'visible-code-block');
        expect(mocked.copyTarget).toHaveBeenCalledWith(
            expect.anything(),
            { kind: 'message', messageId: 'm-focus' },
            expect.anything(),
            expect.any(Function),
            process.stdout,
        );
        await Promise.resolve();
    });

    it('falls back to the latest assistant target on y when there is no focused copy target', async () => {
        mocked.resolveViewportCopyTarget.mockReturnValueOnce({ kind: 'message-latest-assistant' } as any);
        const controller = new CopySelectionController({
            dispatch: vi.fn(),
            renderNow: vi.fn(async () => undefined),
            parsePatchedPathFromLine: () => undefined,
            stdout: process.stdout,
        });

        const handled = controller.handle(
            { type: 'key', key: 'y', raw: '' },
            {
                viewport: { anchorMessageId: 1 },
                transcriptLines: ['user', 'assistant'],
            },
            '/tmp',
        );

        expect(handled).toBe(true);
        expect(mocked.resolveViewportCopyTarget).toHaveBeenCalledWith(expect.anything(), 'latest-assistant');
        expect(mocked.copyTarget).toHaveBeenCalledWith(
            expect.anything(),
            { kind: 'message-latest-assistant' },
            expect.anything(),
            expect.any(Function),
            process.stdout,
        );
        await Promise.resolve();
    });
});
