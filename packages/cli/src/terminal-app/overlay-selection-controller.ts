import * as path from 'node:path';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';

interface OverlaySelectionControllerDeps {
    dispatch: (event: unknown) => void;
    loadKnownModelsForProvider: (provider: string) => Array<{ id: string; label: string }>;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    appendAttachment: (resolvedPath: string) => boolean;
    recordCompleteSelection: (resolvedPath: string) => void;
    executeArgumentsCommand: (commandName: string, values: Record<string, string>) => void;
    onSelectSession: (item: { id: string; title: string }) => void;
    onSelectModel: (item: { id: string }) => void;
    onSelectTheme: (item: { id: string }) => void;
    onSelectInit: (itemId: string | undefined) => void;
    onSelectCommand: (item: { id: string; label: string }) => void;
    onDismissInit: () => void;
}

interface OverlayRuntimeState {
    completeQuery: string;
    completeRootDir: string | null;
}

export class OverlaySelectionController {
    constructor(private readonly deps: OverlaySelectionControllerDeps) {}

    handle(input: TerminalInputEvent, st: any, runtime: OverlayRuntimeState): { handled: boolean; state: OverlayRuntimeState } {
        const next = { ...runtime };

        if (
            st.overlay.type === 'model'
            && ((input.type === 'key' && (input.key === 'left' || input.key === 'right')) || (input.type === 'text' && (input.text === 'h' || input.text === 'l')))
        ) {
            const ov = st.overlay;
            const len = ov.providers.length;
            const goRight = input.type === 'key' ? input.key === 'right' : input.text === 'l';
            const providerIndex = goRight ? (ov.providerIndex + 1) % len : (ov.providerIndex - 1 + len) % len;
            const items = this.deps.loadKnownModelsForProvider(ov.providers[providerIndex]!);
            this.deps.dispatch({ type: 'overlay.modelSetProvider', providerIndex, items });
            this.deps.dispatch({ type: 'notice.set', notice: `Provider: ${ov.providers[providerIndex]}` });
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
            const ov = st.overlay;
            if (ov.type === 'arguments') {
                const values = { ...ov.values, [ov.variables[ov.selectedIndex]!]: ov.editBuffer };
                if (ov.selectedIndex < ov.variables.length - 1) {
                    this.deps.dispatch({ type: 'overlay.argumentsAdvance', values });
                } else {
                    this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'arguments', commandName: ov.commandName, values });
                    this.deps.executeArgumentsCommand(ov.commandName, values);
                }
                return { handled: true, state: next };
            }

            if (ov.type === 'help') {
                this.deps.dispatch({ type: 'overlay.close' });
                return { handled: true, state: next };
            }

            const item = ov.type !== 'init' && 'items' in ov ? ov.items[ov.selectedIndex] : undefined;
            if (ov.type === 'session' && item) {
                const selected = item as { id: string; title: string };
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'session', id: selected.id, title: selected.title });
                this.deps.onSelectSession(selected);
                return { handled: true, state: next };
            }

            if (ov.type === 'model' && item) {
                const selected = item as { id: string };
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'model', id: selected.id });
                this.deps.onSelectModel(selected);
                return { handled: true, state: next };
            }

            if (ov.type === 'theme' && item) {
                const selected = item as { id: string };
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'theme', id: selected.id });
                this.deps.onSelectTheme(selected);
                return { handled: true, state: next };
            }

            if (ov.type === 'init') {
                const selected = ov.items[ov.selectedIndex] as { id?: string } | undefined;
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'init' });
                this.deps.onSelectInit(selected?.id);
                return { handled: true, state: next };
            }

            if (ov.type === 'commands' && item) {
                const selected = item as { id: string; label: string };
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'commands', id: selected.id });
                this.deps.onSelectCommand(selected);
                return { handled: true, state: next };
            }

            if (ov.type === 'filepicker' && item) {
                const selected = item as { path: string; isDir: boolean };
                if (selected.isDir) {
                    const items = this.deps.loadFilepickerEntries(selected.path);
                    this.deps.dispatch({ type: 'overlay.filepickerEnterDir', currentDir: selected.path, items });
                } else {
                    this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'filepicker', path: selected.path });
                    this.deps.appendAttachment(selected.path);
                }
                return { handled: true, state: next };
            }

            if (ov.type === 'complete' && item) {
                const selected = item as { path: string; isDir: boolean };
                if (selected.isDir && next.completeQuery.length === 0) {
                    if (ov.expandedDirs.includes(selected.path)) {
                        this.deps.dispatch({ type: 'overlay.completeCollapse', path: selected.path });
                    } else {
                        const children = this.deps.loadFilepickerEntries(selected.path);
                        this.deps.dispatch({ type: 'overlay.completeExpand', path: selected.path, children });
                    }
                } else {
                    next.completeQuery = '';
                    next.completeRootDir = null;
                    this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'complete', path: selected.path });
                    this.deps.recordCompleteSelection(selected.path);
                    this.deps.appendAttachment(selected.path);
                }
                return { handled: true, state: next };
            }
        }

        if (st.overlay.type === 'filepicker' && input.type === 'text') {
            if (input.text === 'i') {
                this.deps.dispatch({ type: 'overlay.filepickerInputMode', enabled: true });
                return { handled: true, state: next };
            }
            if (input.text === 'h') {
                const currentDir = st.overlay.currentDir as string;
                const parent = path.dirname(currentDir);
                if (parent && parent !== currentDir) {
                    const items = this.deps.loadFilepickerEntries(parent);
                    this.deps.dispatch({ type: 'overlay.filepickerGoParent', currentDir: parent, items });
                }
                return { handled: true, state: next };
            }
        }

        if (input.type === 'text' && input.text === '\u001b') {
            if (st.overlay.type === 'init') {
                this.deps.onDismissInit();
            }
            this.deps.dispatch({ type: 'overlay.close' });
            return { handled: true, state: next };
        }

        return { handled: false, state: next };
    }
}
