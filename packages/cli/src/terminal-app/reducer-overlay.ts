import type { TerminalAppState } from '../terminal-core/app-state.js';
import type { TerminalCoreEvent } from '../terminal-core/types.js';
import { getCommandsEmptyStateText } from '../terminal-core/overlay-text.js';
import { getCompleteOverlayVisibleRowsForState } from './reducer-viewport.js';

type OverlayOpenEvent = Extract<TerminalCoreEvent, { type: 'overlay.open' }>;

function closeOverlayState(state: TerminalAppState): Pick<TerminalAppState, 'overlay' | 'overlayStack'> {
    return {
        overlay: state.overlayStack.length > 0 ? state.overlayStack[state.overlayStack.length - 1]! : null,
        overlayStack: state.overlayStack.length > 0 ? state.overlayStack.slice(0, -1) : state.overlayStack,
    };
}

function clampCompleteOffset(
    state: TerminalAppState,
    itemCount: number,
    selectedIndex: number,
    scrollOffset: number,
): { selectedIndex: number; scrollOffset: number } {
    if (itemCount <= 0) {
        return { selectedIndex: 0, scrollOffset: 0 };
    }

    const safeSelected = Math.max(0, Math.min(itemCount - 1, selectedIndex));
    const visibleRows = getCompleteOverlayVisibleRowsForState(state, itemCount);
    const maxStart = Math.max(0, itemCount - visibleRows);
    let nextOffset = scrollOffset;

    if (safeSelected < nextOffset) {
        nextOffset = safeSelected;
    } else if (safeSelected >= nextOffset + visibleRows) {
        nextOffset = safeSelected - visibleRows + 1;
    }

    return {
        selectedIndex: safeSelected,
        scrollOffset: Math.max(0, Math.min(maxStart, nextOffset)),
    };
}

export function openOverlay(state: TerminalAppState, event: OverlayOpenEvent): TerminalAppState {
    const stackBase = state.overlay ? [...state.overlayStack, state.overlay] : state.overlayStack;
    if (event.kind === 'session') {
        return { ...state, overlayStack: stackBase, overlay: { type: 'session', items: event.items, selectedIndex: 0 } };
    }
    if (event.kind === 'commands') {
        return {
            ...state,
            overlayStack: stackBase,
            overlay: {
                type: 'commands',
                items: event.items,
                allItems: event.items,
                query: '',
                emptyText: event.items.length === 0 ? getCommandsEmptyStateText('') : undefined,
                selectedIndex: 0,
            },
        };
    }
    if (event.kind === 'help') {
        return { ...state, overlayStack: stackBase, overlay: { type: 'help', items: event.items, selectedIndex: 0 } };
    }
    if (event.kind === 'filepicker') {
        return {
            ...state,
            overlayStack: stackBase,
            overlay: {
                type: 'filepicker',
                currentDir: event.currentDir,
                items: event.items,
                selectedIndex: 0,
                history: [],
                inputMode: false,
                pathBuffer: event.currentDir,
            },
        };
    }
    if (event.kind === 'complete') {
        return {
            ...state,
            overlayStack: stackBase,
            overlay: {
                type: 'complete',
                currentDir: event.currentDir,
                items: event.items.map((item) => ({ ...item, depth: 0 })),
                expandedDirs: [],
                selectedIndex: 0,
                scrollOffset: 0,
            },
        };
    }
    if (event.kind === 'theme') {
        return { ...state, overlayStack: stackBase, overlay: { type: 'theme', items: event.items, selectedIndex: 0 } };
    }
    if (event.kind === 'init') {
        return { ...state, overlayStack: stackBase, overlay: { type: 'init', items: event.items, selectedIndex: 0 } };
    }
    if (event.kind === 'arguments') {
        const initialValues = event.initialValues ?? {};
        return {
            ...state,
            overlayStack: stackBase,
            overlay: {
                type: 'arguments',
                commandName: event.commandName,
                variables: event.variables,
                values: initialValues,
                selectedIndex: 0,
                editBuffer: event.variables.length > 0
                    ? (initialValues[event.variables[0]!] ?? '')
                    : '',
            },
        };
    }
    if (event.kind === 'model') {
        return {
            ...state,
            overlayStack: stackBase,
            overlay: {
                type: 'model',
                providers: event.providers,
                providerIndex: event.providerIndex,
                items: event.items,
                selectedIndex: 0,
            },
        };
    }
    return state;
}

export function setOverlayModelProvider(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.modelSetProvider' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay || overlay.type !== 'model') {
        return state;
    }
    return {
        ...state,
        overlay: {
            ...overlay,
            providerIndex: event.providerIndex,
            items: event.items,
            selectedIndex: 0,
        },
    };
}

export function filterCommandsOverlay(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.commandsFilter' }>,
): TerminalAppState {
    if (!state.overlay || state.overlay.type !== 'commands') {
        return state;
    }
    const query = event.query;
    const q = query.trim().toLowerCase();
    const items = q.length === 0
        ? state.overlay.allItems
        : state.overlay.allItems.filter((item) =>
            item.id.toLowerCase().includes(q)
            || item.label.toLowerCase().includes(q)
            || (item.description?.toLowerCase().includes(q) ?? false),
        );
    return {
        ...state,
        overlay: {
            ...state.overlay,
            query,
            items,
            emptyText: items.length === 0 ? getCommandsEmptyStateText(query) : undefined,
            selectedIndex: items.length === 0 ? 0 : Math.min(state.overlay.selectedIndex, items.length - 1),
        },
    };
}

export function enterFilepickerDir(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.filepickerEnterDir' }>,
): TerminalAppState {
    if (!state.overlay || state.overlay.type !== 'filepicker') {
        return state;
    }
    return {
        ...state,
        overlay: {
            ...state.overlay,
            history: [...state.overlay.history, { dir: state.overlay.currentDir, selectedIndex: state.overlay.selectedIndex }],
            currentDir: event.currentDir,
            items: event.items,
            selectedIndex: 0,
            inputMode: false,
            pathBuffer: event.currentDir,
        },
    };
}

export function goFilepickerParent(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.filepickerGoParent' }>,
): TerminalAppState {
    if (!state.overlay || state.overlay.type !== 'filepicker') {
        return state;
    }
    const history = [...state.overlay.history];
    const last = history[history.length - 1];
    const shouldRestore = last?.dir === event.currentDir;
    const restoredIndex = shouldRestore ? Math.max(0, Math.min(event.items.length - 1, last.selectedIndex)) : 0;
    return {
        ...state,
        overlay: {
            ...state.overlay,
            history: shouldRestore ? history.slice(0, -1) : history,
            currentDir: event.currentDir,
            items: event.items,
            selectedIndex: restoredIndex,
            inputMode: false,
            pathBuffer: event.currentDir,
        },
    };
}

export function setFilepickerInputMode(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.filepickerInputMode' }>,
): TerminalAppState {
    if (!state.overlay || state.overlay.type !== 'filepicker') {
        return state;
    }
    return {
        ...state,
        overlay: {
            ...state.overlay,
            inputMode: event.enabled,
            pathBuffer: event.enabled ? state.overlay.currentDir : state.overlay.pathBuffer,
        },
    };
}

export function editFilepickerPath(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.filepickerPathEdit' }>,
): TerminalAppState {
    if (!state.overlay || state.overlay.type !== 'filepicker') {
        return state;
    }
    const nextPath = event.backspace
        ? state.overlay.pathBuffer.slice(0, -1)
        : state.overlay.pathBuffer + (event.append ?? '');
    return {
        ...state,
        overlay: {
            ...state.overlay,
            pathBuffer: nextPath,
        },
    };
}

export function expandCompleteOverlay(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.completeExpand' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay || overlay.type !== 'complete') {
        return state;
    }
    const index = overlay.items.findIndex((item) => item.path === event.path);
    if (index < 0) {
        return state;
    }
    const depth = overlay.items[index]!.depth + 1;
    const children = event.children.map((child) => ({ ...child, depth }));
    const nextItems = [...overlay.items.slice(0, index + 1), ...children, ...overlay.items.slice(index + 1)];
    const nextExpanded = overlay.expandedDirs.includes(event.path)
        ? overlay.expandedDirs
        : [...overlay.expandedDirs, event.path];
    const visibleRows = getCompleteOverlayVisibleRowsForState(state, nextItems.length);
    const maxStart = Math.max(0, nextItems.length - visibleRows);
    return {
        ...state,
        overlay: {
            ...overlay,
            items: nextItems,
            expandedDirs: nextExpanded,
            scrollOffset: Math.min(overlay.scrollOffset, maxStart),
        },
    };
}

export function collapseCompleteOverlay(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.completeCollapse' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay || overlay.type !== 'complete') {
        return state;
    }
    const path = event.path;
    const pathPrefix = path + (path.endsWith('/') ? '' : '/');
    const isUnder = (candidate: string) => candidate !== path && (candidate.startsWith(pathPrefix) || candidate.startsWith(path + '\\'));
    const nextItems = overlay.items.filter((item) => !isUnder(item.path));
    const nextExpanded = overlay.expandedDirs.filter((candidate) => candidate !== path && !isUnder(candidate));
    const visibleRows = getCompleteOverlayVisibleRowsForState(state, nextItems.length);
    const maxStart = Math.max(0, nextItems.length - visibleRows);
    const nextSelectedIndex = Math.min(overlay.selectedIndex, Math.max(0, nextItems.length - 1));
    return {
        ...state,
        overlay: {
            ...overlay,
            items: nextItems,
            expandedDirs: nextExpanded,
            selectedIndex: nextSelectedIndex,
            scrollOffset: Math.min(overlay.scrollOffset, maxStart),
        },
    };
}

export function scrollCompleteOverlayAt(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.completeScrollAt' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay || overlay.type !== 'complete') {
        return state;
    }
    const length = overlay.items.length;
    if (length === 0) {
        return state;
    }
    const visibleRows = getCompleteOverlayVisibleRowsForState(state, length);
    const maxStart = Math.max(0, length - visibleRows);
    const nextOffset = Math.max(0, Math.min(maxStart, overlay.scrollOffset + event.delta));
    const safeAnchor = Math.max(0, Math.min(visibleRows - 1, event.anchorRow));
    const nextSelected = Math.max(0, Math.min(length - 1, nextOffset + safeAnchor));
    return {
        ...state,
        overlay: {
            ...overlay,
            scrollOffset: nextOffset,
            selectedIndex: nextSelected,
        },
    };
}

export function setCompleteOverlaySelected(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.completeSetSelected' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay || overlay.type !== 'complete') {
        return state;
    }
    const next = clampCompleteOffset(state, overlay.items.length, event.index, overlay.scrollOffset);
    return {
        ...state,
        overlay: {
            ...overlay,
            selectedIndex: next.selectedIndex,
            scrollOffset: next.scrollOffset,
        },
    };
}

export function moveOverlaySelection(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.move' }>,
): TerminalAppState {
    const overlay = state.overlay;
    if (!overlay) {
        return state;
    }
    const length = overlay.type === 'arguments' ? overlay.variables.length : overlay.items.length;
    const nextIndex = Math.max(0, Math.min(length - 1, overlay.selectedIndex + event.delta));
    const nextEditBuffer = overlay.type === 'arguments'
        ? (overlay.values[overlay.variables[nextIndex]!] ?? '')
        : undefined;

    if (overlay.type === 'complete') {
        const next = clampCompleteOffset(state, length, nextIndex, overlay.scrollOffset);
        return {
            ...state,
            overlay: {
                ...overlay,
                selectedIndex: next.selectedIndex,
                scrollOffset: next.scrollOffset,
            },
        };
    }

    return {
        ...state,
        overlay: {
            ...overlay,
            selectedIndex: nextIndex,
            ...(nextEditBuffer !== undefined ? { editBuffer: nextEditBuffer } : {}),
        },
    };
}

export function editArgumentsOverlay(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.argumentsEdit' }>,
): TerminalAppState {
    if (state.overlay?.type !== 'arguments') {
        return state;
    }
    const overlay = state.overlay;
    const editBuffer = event.backspace
        ? overlay.editBuffer.slice(0, -1)
        : overlay.editBuffer + (event.append ?? '');
    return {
        ...state,
        overlay: {
            ...overlay,
            editBuffer,
        },
    };
}

export function advanceArgumentsOverlay(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.argumentsAdvance' }>,
): TerminalAppState {
    if (state.overlay?.type !== 'arguments') {
        return state;
    }
    const overlay = state.overlay;
    const nextIndex = overlay.selectedIndex + 1;
    const editBuffer = nextIndex < overlay.variables.length
        ? (event.values[overlay.variables[nextIndex]!] ?? '')
        : '';
    return {
        ...state,
        overlay: {
            ...overlay,
            values: event.values,
            selectedIndex: nextIndex,
            editBuffer,
        },
    };
}

export function closeOverlay(state: TerminalAppState): TerminalAppState {
    return {
        ...state,
        ...closeOverlayState(state),
    };
}

export function closeOverlayWithSelect(
    state: TerminalAppState,
    event: Extract<TerminalCoreEvent, { type: 'overlay.closeWithSelect' }>,
): TerminalAppState {
    return {
        ...state,
        ...closeOverlayState(state),
        ...(event.kind === 'theme' ? { themeId: event.id } : {}),
    };
}
