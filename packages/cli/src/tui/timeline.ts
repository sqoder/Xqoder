import * as path from 'node:path';
import type { ChatMessage } from './message.js';
import type { FileChange, ToolExecution } from './layout.js';

export type TimelineEntryKind = 'session' | 'tool' | 'file' | 'system';

export interface TimelineEntry {
    id: string;
    kind: TimelineEntryKind;
    title: string;
    summary: string;
    detail: string;
    timestamp: Date;
    sourceIndex?: number;
}

export interface TimelineSection {
    title: string;
    entries: TimelineEntry[];
}

export interface TimelineState {
    selectedIndex: number;
    expandedIds: string[];
}

export type TimelineAction = 'next' | 'prev' | 'toggle';
export type PanelNavigationAction = 'next' | 'prev';

export function buildGroupedTimelineSections(entries: TimelineEntry[]): TimelineSection[] {
    const groups: Array<{ title: string; kinds: TimelineEntryKind[] }> = [
        { title: 'Session', kinds: ['session'] },
        { title: 'Tools', kinds: ['tool'] },
        { title: 'Files', kinds: ['file'] },
        { title: 'System', kinds: ['system'] },
    ];

    return groups
        .map((group) => ({
            title: group.title,
            entries: entries.filter((entry) => group.kinds.includes(entry.kind)),
        }))
        .filter((section) => section.entries.length > 0);
}

export function buildVisibleTimelineSections(entries: TimelineEntry[], maxEntries: number): TimelineSection[] {
    return buildGroupedTimelineSections(entries.slice(0, Math.max(0, maxEntries)));
}

export function getNextPanelIndex(currentIndex: number, panelCount: number, action: PanelNavigationAction): number {
    if (panelCount <= 0) {
        return 0;
    }

    if (action === 'next') {
        return Math.min(panelCount - 1, currentIndex + 1);
    }

    return Math.max(0, currentIndex - 1);
}

export function buildTimelineEntries(options: {
    sessionTitle?: string;
    sessionId?: string;
    toolExecutions: ToolExecution[];
    fileChanges: FileChange[];
    systemMessages?: Pick<ChatMessage, 'id' | 'content' | 'timestamp'>[];
}): TimelineEntry[] {
    const entries: TimelineEntry[] = [];

    if (options.sessionId || options.sessionTitle) {
        entries.push({
            id: `session:${options.sessionId ?? 'current'}`,
            kind: 'session',
            title: options.sessionTitle ?? options.sessionId ?? 'Current session',
            summary: options.sessionId ? `Session ${options.sessionId}` : 'Current session',
            detail: [
                options.sessionTitle ? `Title: ${options.sessionTitle}` : undefined,
                options.sessionId ? `Session: ${options.sessionId}` : undefined,
            ].filter(Boolean).join('\n'),
            timestamp: new Date(0),
        });
    }

    for (const [index, execution] of options.toolExecutions.entries()) {
        const endedAt = execution.endedAt ?? execution.startedAt;
        entries.push({
            id: `tool:${execution.id}`,
            kind: 'tool',
            title: execution.name,
            summary: execution.success === false
                ? 'Tool failed'
                : execution.endedAt
                    ? 'Tool completed'
                    : 'Tool running',
            detail: [
                `Args: ${JSON.stringify(execution.args)}`,
                execution.output ? `Output: ${execution.output}` : undefined,
            ].filter(Boolean).join('\n'),
            timestamp: endedAt,
            sourceIndex: index,
        });
    }

    for (const [index, change] of options.fileChanges.entries()) {
        entries.push({
            id: `file:${change.timestamp.toISOString()}:${change.filePath}`,
            kind: 'file',
            title: path.basename(change.filePath),
            summary: `${change.toolName} changed ${change.filePath}`,
            detail: [
                `Path: ${change.filePath}`,
                `Tool: ${change.toolName}`,
            ].join('\n'),
            timestamp: change.timestamp,
            sourceIndex: index,
        });
    }

    for (const message of options.systemMessages ?? []) {
        entries.push({
            id: `system:${message.id}`,
            kind: 'system',
            title: message.content.split('\n')[0] ?? 'System message',
            summary: message.content,
            detail: message.content,
            timestamp: message.timestamp ?? new Date(0),
        });
    }

    return entries.sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
}

export function getInitialTimelineState(entries: TimelineEntry[]): TimelineState {
    const first = entries[0];
    return {
        selectedIndex: 0,
        expandedIds: first ? [first.id] : [],
    };
}

export function syncPanelSelectionFromTimeline(
    entry: TimelineEntry | undefined,
    state: {
        showToolDetails: boolean;
        showDiff: boolean;
        selectedToolIndex: number;
        selectedDiffIndex: number;
        expandedToolIds: string[];
    },
): {
    showToolDetails: boolean;
    showDiff: boolean;
    selectedToolIndex: number;
    selectedDiffIndex: number;
    expandedToolIds: string[];
} {
    if (!entry) {
        return state;
    }

    if (entry.kind === 'tool' && typeof entry.sourceIndex === 'number') {
        return {
            ...state,
            showToolDetails: true,
            selectedToolIndex: entry.sourceIndex,
            expandedToolIds: state.expandedToolIds.includes(entry.id)
                ? state.expandedToolIds
                : [...state.expandedToolIds, entry.id],
        };
    }

    if (entry.kind === 'file' && typeof entry.sourceIndex === 'number') {
        return {
            ...state,
            showDiff: true,
            selectedDiffIndex: entry.sourceIndex,
        };
    }

    return state;
}
export function syncTimelineSelectionFromPanel(
    entries: TimelineEntry[],
    state: TimelineState,
    panel: {
        kind: 'tool' | 'file';
        sourceIndex: number;
    },
): TimelineState {
    const nextIndex = entries.findIndex((entry) => entry.kind === panel.kind && entry.sourceIndex === panel.sourceIndex);
    if (nextIndex === -1) {
        return state;
    }

    const selected = entries[nextIndex];
    const expandedIds = selected && !state.expandedIds.includes(selected.id)
        ? [...state.expandedIds, selected.id]
        : state.expandedIds;

    return {
        selectedIndex: nextIndex,
        expandedIds,
    };
}

export function getNextTimelineState(
    state: TimelineState,
    entries: TimelineEntry[],
    action: TimelineAction,
): TimelineState {
    if (entries.length === 0) {
        return { selectedIndex: 0, expandedIds: [] };
    }

    if (action === 'next') {
        return {
            ...state,
            selectedIndex: Math.min(entries.length - 1, state.selectedIndex + 1),
        };
    }

    if (action === 'prev') {
        return {
            ...state,
            selectedIndex: Math.max(0, state.selectedIndex - 1),
        };
    }

    const selected = entries[state.selectedIndex];
    if (!selected) {
        return state;
    }

    const expandedIds = state.expandedIds.includes(selected.id)
        ? state.expandedIds.filter((id: string) => id !== selected.id)
        : [...state.expandedIds, selected.id];

    return {
        ...state,
        expandedIds,
    };
}
