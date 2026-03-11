import { describe, expect, it } from 'vitest';
import { closeDialogs, getVisiblePanels, openOnlyDialog, togglePage, toggleToolPanel, type ToolPanelState } from './app-shell-state.js';
import type { TimelineEntry } from './timeline.js';

const timelineEntries: TimelineEntry[] = [
    {
        id: 'tool:1',
        kind: 'tool',
        title: 'Read',
        summary: 'Tool completed',
        detail: 'detail',
        timestamp: new Date('2026-03-10T12:00:00.000Z'),
        sourceIndex: 0,
    },
];

const defaultPanelState: ToolPanelState = {
    visiblePanels: [],
    focusedPanel: 'timeline',
    timelineSelectedIndex: 0,
    timelineExpandedIds: [],
};

describe('app shell state helpers', () => {
    it('opens one dialog at a time', () => {
        expect(openOnlyDialog('help')).toBe('help');
        expect(closeDialogs()).toBeNull();
    });

    it('toggles between chat and logs pages', () => {
        expect(togglePage('chat')).toBe('logs');
        expect(togglePage('logs')).toBe('chat');
    });

    it('turns on tool details and bootstraps timeline when needed', () => {
        expect(toggleToolPanel('tool', defaultPanelState, timelineEntries)).toEqual({
            visiblePanels: ['tool', 'timeline'],
            focusedPanel: 'tool',
            timelineSelectedIndex: 0,
            timelineExpandedIds: ['tool:1'],
        });
    });

    it('keeps visible panels in deterministic order', () => {
        expect(getVisiblePanels({
            visiblePanels: ['diff', 'tool'],
        })).toEqual(['tool', 'diff']);
    });
});
