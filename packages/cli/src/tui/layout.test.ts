import { describe, expect, it } from 'vitest';
import { buildChatShellMetrics, buildStatusBadges, resolveSidePanelKind } from './layout.js';
import { buildVisibleTimelineSections, getNextPanelIndex } from './timeline.js';

describe('layout status badges', () => {
    it('shows timeline badge state when timeline is enabled', () => {
        expect(buildStatusBadges({
            visibleSidePanels: ['timeline'],
            timelineCount: 4,
            timelineSelectedIndex: 2,
        })).toEqual([
            'timeline:3/4',
        ]);
    });

    it('shows active command details diff and timeline badges together', () => {
        expect(buildStatusBadges({
            activeCommand: 'chat',
            visibleSidePanels: ['tool', 'diff', 'timeline'],
            toolExecutionCount: 3,
            fileChangeCount: 2,
            diffSelectedIndex: 1,
            timelineCount: 4,
            timelineSelectedIndex: 2,
        })).toEqual([
            'run:chat',
            'details:3',
            'diff:2/2',
            'timeline:3/4',
        ]);
    });

    it('shows empty diff state when diff is enabled without file changes', () => {
        expect(buildStatusBadges({
            visibleSidePanels: ['diff'],
            fileChangeCount: 0,
        })).toEqual([
            'diff:empty',
        ]);
    });

    it('shows empty details state when details is enabled without tool executions', () => {
        expect(buildStatusBadges({
            visibleSidePanels: ['tool'],
            toolExecutionCount: 0,
        })).toEqual([
            'details:0',
        ]);
    });

    it('keeps visible timeline sections aligned with the entry window', () => {
        const entries = [
            {
                id: 'system:1',
                kind: 'system' as const,
                title: 'System',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:03:00.000Z'),
            },
            {
                id: 'file:1',
                kind: 'file' as const,
                title: 'app.tsx',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:02:00.000Z'),
                sourceIndex: 0,
            },
            {
                id: 'tool:1',
                kind: 'tool' as const,
                title: 'Read',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:01:00.000Z'),
                sourceIndex: 0,
            },
        ];

        expect(buildVisibleTimelineSections(entries, 2).map((section: { title: string }) => section.title)).toEqual(['Files', 'System']);
    });

    it('keeps panel navigation selection inside valid bounds', () => {
        expect(getNextPanelIndex(0, 2, 'prev')).toBe(0);
        expect(getNextPanelIndex(0, 2, 'next')).toBe(1);
        expect(getNextPanelIndex(1, 2, 'next')).toBe(1);
    });

    it('omits badges when optional states are disabled', () => {
        expect(buildStatusBadges({
            activeCommand: undefined,
            visibleSidePanels: [],
        })).toEqual([]);
    });

    it('prefers the active side panel when it is enabled', () => {
        expect(resolveSidePanelKind({
            focusedSidePanel: 'diff',
            visibleSidePanels: ['tool', 'diff', 'timeline'],
        })).toBe('diff');
    });

    it('falls back to the first available side panel when active panel is hidden', () => {
        expect(resolveSidePanelKind({
            focusedSidePanel: 'diff',
            visibleSidePanels: ['tool', 'timeline'],
        })).toBe('timeline');
    });

    it('allocates a right rail when sidebar and side panel are visible', () => {
        const metrics = buildChatShellMetrics({
            width: 140,
            height: 42,
            showSidebar: true,
            sidePanelKind: 'timeline',
            completionHeight: 6,
            editorBoxHeight: 6,
        });

        expect(metrics.sideColumnWidth).toBeGreaterThan(0);
        expect(metrics.mainColumnWidth).toBeLessThan(140);
        expect(metrics.sidebarHeight).toBeGreaterThan(0);
        expect(metrics.panelHeight).toBeGreaterThan(0);
        expect(metrics.transcriptHeight).toBeGreaterThan(0);
    });
});
