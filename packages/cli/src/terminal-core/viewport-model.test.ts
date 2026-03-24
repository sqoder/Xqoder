import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    createViewportModel,
} from './viewport-model.js';
import {
    moveLogViewportToBottom,
    pageLogViewportModel,
    setLogViewportTopLine,
    scrollLogViewportModel,
    syncLogViewportModel,
} from '../terminal-app/log-viewport-model.js';
import {
    buildTranscriptScrollbarModel,
    resolveTranscriptTopLineFromJump,
    resolveTranscriptTopLineFromScrollbar,
} from './transcript-viewport-queries.js';
import { buildViewportSelectedText } from './viewport-selection-text.js';
import { rustTui } from './rust-tui.js';

describe('viewport model', () => {
    const makeLogLines = (count: number) => Array.from({ length: count }, (_, index) => `log line ${index}`);
    const geometry = { height: 20, contentWidth: 80 };
    const controller = rustTui as unknown as {
        refreshLogViewport: (logLines: string[], contentWidth: number, viewportHeight: number) => void;
        applyLogViewportIntent: (intent: { kind: string; delta?: number; direction?: 'up' | 'down'; pageSize?: number; topLine?: number }) => void;
        queryLogViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
    };
    const original = {
        refreshLogViewport: controller.refreshLogViewport,
        applyLogViewportIntent: controller.applyLogViewportIntent,
        queryLogViewport: controller.queryLogViewport,
    };

    let scrollOffset = 0;
    let stickyBottom = true;
    let maxScroll = 0;

    beforeEach(() => {
        scrollOffset = 0;
        stickyBottom = true;
        maxScroll = 0;

        controller.refreshLogViewport = (logLines, _contentWidth, viewportHeight) => {
            maxScroll = Math.max(0, logLines.length - viewportHeight);
            if (stickyBottom || scrollOffset + 3 >= maxScroll) {
                stickyBottom = true;
                scrollOffset = maxScroll;
                return;
            }
            scrollOffset = Math.min(scrollOffset, maxScroll);
        };
        controller.applyLogViewportIntent = (intent) => {
            switch (intent.kind) {
                case 'delta':
                    if ((intent.delta ?? 0) < 0) {
                        stickyBottom = false;
                    }
                    scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + (intent.delta ?? 0)));
                    if (scrollOffset + 3 >= maxScroll) {
                        stickyBottom = true;
                    }
                    return;
                case 'page': {
                    const delta = intent.direction === 'up' ? -(intent.pageSize ?? 0) : (intent.pageSize ?? 0);
                    if (delta < 0) {
                        stickyBottom = false;
                    }
                    scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + delta));
                    if (scrollOffset + 3 >= maxScroll) {
                        stickyBottom = true;
                    }
                    return;
                }
                case 'home':
                    stickyBottom = false;
                    scrollOffset = 0;
                    return;
                case 'end':
                    stickyBottom = true;
                    scrollOffset = maxScroll;
                    return;
                case 'set-top-line':
                    scrollOffset = Math.max(0, Math.min(maxScroll, intent.topLine ?? 0));
                    stickyBottom = scrollOffset + 3 >= maxScroll;
                    return;
                default:
                    return;
            }
        };
        controller.queryLogViewport = () => ({
            scrollOffset,
            isFollowingBottom: stickyBottom,
        });
    });

    afterEach(() => {
        controller.refreshLogViewport = original.refreshLogViewport;
        controller.applyLogViewportIntent = original.applyLogViewportIntent;
        controller.queryLogViewport = original.queryLogViewport;
    });

    it('scrolls and computes scrollbars', () => {
        const lines = makeLogLines(120);
        const base = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const up = scrollLogViewportModel(base, -4, lines, geometry);

        expect(up.isFollowingBottom).toBe(false);
        expect(buildTranscriptScrollbarModel(120, 20, up.scrollOffset).visible).toBe(true);
        expect(resolveTranscriptTopLineFromScrollbar(120, 20, 19)).toBeGreaterThan(0);
        expect(pageLogViewportModel(base, 'up', lines, geometry).scrollOffset).toBeLessThan(base.scrollOffset);
    });

    it('extracts selected text across lines', () => {
        expect(buildViewportSelectedText(
            ['hello world', 'second line'],
            {
                start: { line: 0, column: 6 },
                end: { line: 1, column: 6 },
            },
        )).toBe('world\nsecond');
    });

    it('auto-follows again when still near bottom threshold', () => {
        const lines = makeLogLines(120);
        const nextLines = makeLogLines(121);
        const bottom = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const nearBottomManual = scrollLogViewportModel(bottom, -2, lines, geometry);
        const synced = syncLogViewportModel(nearBottomManual, nextLines, geometry);

        expect(synced.isFollowingBottom).toBe(true);
        expect(synced.scrollOffset).toBe(101);
    });

    it('new messages follow bottom when following flag is on', () => {
        const lines = makeLogLines(120);
        const nextLines = makeLogLines(130);
        const bottom = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const synced = syncLogViewportModel(bottom, nextLines, geometry);

        expect(synced.isFollowingBottom).toBe(true);
        expect(synced.scrollOffset).toBe(110);
    });

    it('manual up beyond threshold disables follow after sync', () => {
        const lines = makeLogLines(120);
        const nextLines = makeLogLines(130);
        const bottom = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const manualUp = scrollLogViewportModel(bottom, -10, lines, geometry);
        expect(manualUp.isFollowingBottom).toBe(false);

        const synced = syncLogViewportModel(manualUp, nextLines, geometry);

        expect(synced.isFollowingBottom).toBe(false);
        expect(synced.scrollOffset).toBe(manualUp.scrollOffset);
    });

    it('resize keeps anchorMessageId stable', () => {
        const lines = makeLogLines(120);
        const base = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const withAnchor = { ...base, anchorMessageId: 42 };
        const resized = syncLogViewportModel(withAnchor, lines, { ...geometry, height: 25 });

        expect(resized.anchorMessageId).toBe(42);
    });

    it('pages by roughly 85% of viewport height', () => {
        const lines = makeLogLines(120);
        const base = moveLogViewportToBottom(createViewportModel(), lines, geometry);
        const paged = pageLogViewportModel(base, 'up', lines, geometry);

        expect(paged.scrollOffset).toBe(83);
    });

    it('resolves jump topLine using one-third anchor intent', () => {
        expect(resolveTranscriptTopLineFromJump(120, 20, 60, 1, 3)).toBe(54);
        expect(resolveTranscriptTopLineFromJump(120, 20, 119, 1, 3)).toBe(100);
    });

    it('keeps scrollbar thumb/topLine mapping consistent', () => {
        const lineCount = 120;
        const height = 20;
        const scrollOffset = 60; // within [0, 100]

        const scrollbar = buildTranscriptScrollbarModel(lineCount, height, scrollOffset);
        expect(scrollbar.visible).toBe(true);

        // 用 thumb 中心点做指针位置：验证回推 topLine 后再算 thumbTop 与原 thumbTop 近似一致
        const pointerRow = Math.max(0, Math.floor(scrollbar.thumbTop + scrollbar.thumbHeight / 2));
        const resolvedTopLine = resolveTranscriptTopLineFromScrollbar(lineCount, height, pointerRow);

        const scrollbar2 = buildTranscriptScrollbarModel(lineCount, height, resolvedTopLine);
        expect(Math.abs(scrollbar2.thumbTop - scrollbar.thumbTop)).toBeLessThanOrEqual(1);
    });

    it('keeps long transcript scrolling stable (2000 lines)', () => {
        const lineCount = 2000;
        const lines = makeLogLines(lineCount);
        const view = { height: 24, contentWidth: 80 };
        const base = moveLogViewportToBottom(createViewportModel(), lines, view);
        expect(base.scrollOffset).toBeGreaterThan(0);

        const up = pageLogViewportModel(base, 'up', lines, view);
        expect(up.scrollOffset).toBeLessThan(base.scrollOffset);
        expect(up.isFollowingBottom).toBe(false);

        const jumped = setLogViewportTopLine(up, 1500, lines, view);
        expect(jumped.scrollOffset).toBeGreaterThanOrEqual(0);
        expect(jumped.scrollOffset).toBeLessThan(lineCount);

        const bottomAgain = moveLogViewportToBottom(jumped, lines, view);
        expect(bottomAgain.isFollowingBottom).toBe(true);
        expect(bottomAgain.scrollOffset).toBeGreaterThan(jumped.scrollOffset);
    });
});
