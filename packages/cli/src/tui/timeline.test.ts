import { describe, expect, it } from 'vitest';
import {
    buildGroupedTimelineSections,
    buildTimelineEntries,
    buildVisibleTimelineSections,
    getInitialTimelineState,
    getNextPanelIndex,
    getNextTimelineState,
    syncPanelSelectionFromTimeline,
    syncTimelineSelectionFromPanel,
    type TimelineEntry,
} from './timeline.js';

describe('timeline model', () => {
    it('merges session tool file and message events in reverse chronological order', () => {
        const entries = buildTimelineEntries({
            sessionTitle: '修一下 TUI',
            sessionId: 'session_1',
            toolExecutions: [
                {
                    id: 'tool_1',
                    name: 'Read',
                    args: { file_path: 'src/app.tsx' },
                    startedAt: new Date('2026-03-10T10:00:00.000Z'),
                    endedAt: new Date('2026-03-10T10:00:03.000Z'),
                    success: true,
                    output: 'ok',
                },
            ],
            fileChanges: [
                {
                    filePath: '/workspace/src/app.tsx',
                    before: 'a',
                    after: 'b',
                    toolName: 'Edit',
                    timestamp: new Date('2026-03-10T10:00:05.000Z'),
                },
            ],
            systemMessages: [
                {
                    id: 'msg_1',
                    content: 'Exported current session as Markdown: session.md',
                    timestamp: new Date('2026-03-10T10:00:04.000Z'),
                },
            ],
        });

        expect(entries.map(entry => entry.kind)).toEqual(['file', 'system', 'tool', 'session']);
        expect(entries[0]).toMatchObject({
            kind: 'file',
            title: 'app.tsx',
        });
        expect(entries[1]).toMatchObject({
            kind: 'system',
            title: 'Exported current session as Markdown: session.md',
        });
        expect(entries[2]).toMatchObject({
            kind: 'tool',
            title: 'Read',
        });
        expect(entries[3]).toMatchObject({
            kind: 'session',
            title: '修一下 TUI',
        });
    });

    it('builds a stable initial selection state', () => {
        const entries: TimelineEntry[] = [
            {
                id: 'timeline_1',
                kind: 'session',
                title: 'Session started',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:00:00.000Z'),
            },
        ];

        expect(getInitialTimelineState(entries)).toEqual({
            selectedIndex: 0,
            expandedIds: ['timeline_1'],
        });
    });

    it('limits grouped timeline sections to the visible entry window', () => {
        const entries: TimelineEntry[] = [
            {
                id: 'system:1',
                kind: 'system',
                title: 'Exported',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:03:00.000Z'),
            },
            {
                id: 'file:1',
                kind: 'file',
                title: 'app.tsx',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:02:00.000Z'),
                sourceIndex: 0,
            },
            {
                id: 'tool:1',
                kind: 'tool',
                title: 'Read',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:01:00.000Z'),
                sourceIndex: 0,
            },
            {
                id: 'session:1',
                kind: 'session',
                title: 'Session',
                summary: 'summary',
                detail: 'detail',
                timestamp: new Date('2026-03-10T10:00:00.000Z'),
            },
        ];

        const sections = buildVisibleTimelineSections(entries, 2);

        expect(sections).toEqual([
            {
                title: 'Files',
                entries: [entries[1]!],
            },
            {
                title: 'System',
                entries: [entries[0]!],
            },
        ]);
    });

    it('cycles panel selection within bounds', () => {
        expect(getNextPanelIndex(1, 3, 'next')).toBe(2);
        expect(getNextPanelIndex(2, 3, 'next')).toBe(2);
        expect(getNextPanelIndex(1, 3, 'prev')).toBe(0);
        expect(getNextPanelIndex(0, 3, 'prev')).toBe(0);
        expect(getNextPanelIndex(0, 0, 'next')).toBe(0);
    });

    it('syncs diff and tool detail selection from the selected timeline entry', () => {
        expect(syncPanelSelectionFromTimeline({
            id: 'tool:1',
            kind: 'tool',
            title: 'Read',
            summary: 'Tool completed',
            detail: 'detail',
            timestamp: new Date('2026-03-10T10:00:00.000Z'),
            sourceIndex: 2,
        }, {
            showToolDetails: false,
            showDiff: false,
            selectedToolIndex: 0,
            selectedDiffIndex: 0,
            expandedToolIds: [],
        })).toEqual({
            showToolDetails: true,
            showDiff: false,
            selectedToolIndex: 2,
            selectedDiffIndex: 0,
            expandedToolIds: ['tool:1'],
        });

        expect(syncPanelSelectionFromTimeline({
            id: 'file:1',
            kind: 'file',
            title: 'app.tsx',
            summary: 'changed',
            detail: 'detail',
            timestamp: new Date('2026-03-10T10:00:00.000Z'),
            sourceIndex: 1,
        }, {
            showToolDetails: true,
            showDiff: false,
            selectedToolIndex: 2,
            selectedDiffIndex: 0,
            expandedToolIds: ['tool:1'],
        })).toEqual({
            showToolDetails: true,
            showDiff: true,
            selectedToolIndex: 2,
            selectedDiffIndex: 1,
            expandedToolIds: ['tool:1'],
        });
    });
});
