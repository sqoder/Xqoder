import { type OverlayType, type PageType, type SidePanelState, type SidePanelType } from './types.js';
import { getInitialTimelineState, type TimelineEntry } from './timeline.js';

export type ActivePanel = SidePanelType;

const PANEL_ORDER: ActivePanel[] = ['tool', 'diff', 'timeline'];
const PANEL_FALLBACK_ORDER: ActivePanel[] = ['timeline', 'diff', 'tool'];

export interface ToolPanelState extends SidePanelState {
    timelineSelectedIndex: number;
    timelineExpandedIds: string[];
}

function normalizeVisiblePanels(visiblePanels: SidePanelType[]): ActivePanel[] {
    return PANEL_ORDER.filter((panel) => visiblePanels.includes(panel));
}

function resolveFocusedPanel(visiblePanels: SidePanelType[], preferredPanel?: SidePanelType): ActivePanel {
    const normalizedPanels = normalizeVisiblePanels(visiblePanels);
    if (preferredPanel && normalizedPanels.includes(preferredPanel)) {
        return preferredPanel;
    }

    return PANEL_FALLBACK_ORDER.find((panel) => normalizedPanels.includes(panel)) ?? 'timeline';
}

export function openOnlyDialog(key: OverlayType): OverlayType {
    return key;
}

export function closeDialogs(): null {
    return null;
}

export function togglePage(currentPage: PageType): PageType {
    return currentPage === 'logs' ? 'chat' : 'logs';
}

export function getVisiblePanels(state: Pick<ToolPanelState, 'visiblePanels'> | ActivePanel[]): ActivePanel[] {
    return normalizeVisiblePanels(Array.isArray(state) ? state : state.visiblePanels);
}

export function isPanelVisible(state: Pick<ToolPanelState, 'visiblePanels'>, panel: ActivePanel): boolean {
    return getVisiblePanels(state).includes(panel);
}

export function toggleToolPanel(
    kind: ActivePanel,
    state: ToolPanelState,
    timelineEntries: TimelineEntry[],
): ToolPanelState {
    const initialTimelineState = getInitialTimelineState(timelineEntries);
    const visiblePanels = new Set(getVisiblePanels(state));

    if (kind === 'timeline') {
        if (visiblePanels.has('timeline')) {
            visiblePanels.delete('timeline');
            return {
                ...state,
                visiblePanels: getVisiblePanels([...visiblePanels]),
                focusedPanel: resolveFocusedPanel([...visiblePanels], state.focusedPanel === 'timeline' ? undefined : state.focusedPanel),
            };
        }

        visiblePanels.add('timeline');
        return {
            ...state,
            visiblePanels: getVisiblePanels([...visiblePanels]),
            focusedPanel: 'timeline',
            timelineSelectedIndex: initialTimelineState.selectedIndex,
            timelineExpandedIds: initialTimelineState.expandedIds,
        };
    }

    if (visiblePanels.has(kind)) {
        visiblePanels.delete(kind);
        return {
            ...state,
            visiblePanels: getVisiblePanels([...visiblePanels]),
            focusedPanel: resolveFocusedPanel([...visiblePanels], state.focusedPanel === kind ? undefined : state.focusedPanel),
        };
    }

    const bootstrappedTimeline = !visiblePanels.has('timeline');
    visiblePanels.add(kind);
    visiblePanels.add('timeline');

    return {
        ...state,
        visiblePanels: getVisiblePanels([...visiblePanels]),
        focusedPanel: kind,
        timelineSelectedIndex: bootstrappedTimeline
            ? initialTimelineState.selectedIndex
            : state.timelineSelectedIndex,
        timelineExpandedIds: bootstrappedTimeline
            ? initialTimelineState.expandedIds
            : state.timelineExpandedIds,
    };
}
