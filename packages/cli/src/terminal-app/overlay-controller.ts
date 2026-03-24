import * as path from 'node:path';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { OverlayMouseController } from './overlay-mouse-controller.js';
import { OverlayInputModeController } from './overlay-inputmode-controller.js';

interface OverlayControllerDeps {
    dispatch: (event: unknown) => void;
    getState: () => any;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    loadCompleteSearchEntries: (dir: string, query: string) => Array<{ path: string; label: string; isDir: boolean }>;
    recordCompleteSelection: (resolvedPath: string) => void;
    resolveFilepickerInputPath: (currentDir: string, target: string) => string;
    appendAttachment: (resolvedPath: string) => void;
    executeArgumentsCommand: (commandName: string, values: Record<string, string>) => void;
    setNotice: (notice: string) => void;
}

interface OverlayRuntimeState {
    completeQuery: string;
    completeRootDir: string | null;
}

export class OverlayController {
    private readonly mouseController: OverlayMouseController;
    private readonly inputModeController: OverlayInputModeController;

    constructor(private readonly deps: OverlayControllerDeps) {
        this.mouseController = new OverlayMouseController({
            dispatch: deps.dispatch,
            loadFilepickerEntries: deps.loadFilepickerEntries,
            recordCompleteSelection: deps.recordCompleteSelection,
            appendAttachment: deps.appendAttachment,
        });
        this.inputModeController = new OverlayInputModeController({
            dispatch: deps.dispatch,
            loadFilepickerEntries: deps.loadFilepickerEntries,
            resolveFilepickerInputPath: deps.resolveFilepickerInputPath,
            appendAttachment: deps.appendAttachment,
            setNotice: deps.setNotice,
        });
    }

    handle(input: TerminalInputEvent, st: any, runtime: OverlayRuntimeState): { handled: boolean; state: OverlayRuntimeState } {
        let next = { ...runtime };

        const mouseHandled = this.mouseController.handle(input, st, next);
        if (mouseHandled.handled) {
            return mouseHandled;
        }
        next = mouseHandled.state;

        const inputModeHandled = this.inputModeController.handle(input, st, next);
        if (inputModeHandled.handled) {
            return inputModeHandled;
        }
        next = inputModeHandled.state;

        if (st.overlay.type === 'complete' && input.type === 'text' && input.text === ' ') {
            next = { completeQuery: '', completeRootDir: null };
            this.deps.dispatch({ type: 'overlay.close' });
            this.deps.dispatch({ type: 'input', input: { type: 'text', text: ' ', raw: ' ' } });
            return { handled: true, state: next };
        }

        if (
            st.overlay.type === 'complete'
            && input.type === 'text'
            && input.text.length > 0
            && input.text !== 'j'
            && input.text !== 'k'
            && input.text !== 'l'
        ) {
            const completeQuery = next.completeQuery + input.text;
            const rootDir = next.completeRootDir ?? st.overlay.currentDir;
            const items = this.deps.loadCompleteSearchEntries(rootDir, completeQuery);
            this.deps.dispatch({ type: 'overlay.open', kind: 'complete', currentDir: rootDir, items });
            next = { completeQuery, completeRootDir: rootDir };
            return { handled: true, state: next };
        }

        if (input.type === 'text' && input.text === 'l' && (st.overlay.type === 'filepicker' || st.overlay.type === 'complete')) {
            const sel = st.overlay.items[st.overlay.selectedIndex] as { path: string; isDir: boolean } | undefined;
            if (sel?.isDir) {
                if (st.overlay.type === 'filepicker') {
                    const items = this.deps.loadFilepickerEntries(sel.path);
                    this.deps.dispatch({ type: 'overlay.filepickerEnterDir', currentDir: sel.path, items });
                } else if (st.overlay.expandedDirs.includes(sel.path)) {
                    this.deps.dispatch({ type: 'overlay.completeCollapse', path: sel.path });
                } else {
                    const children = this.deps.loadFilepickerEntries(sel.path);
                    this.deps.dispatch({ type: 'overlay.completeExpand', path: sel.path, children });
                }
                return { handled: true, state: next };
            }
        }

        if (st.overlay.type === 'arguments') {
            if (input.type === 'text') {
                this.deps.dispatch({ type: 'overlay.argumentsEdit', append: input.text });
                return { handled: true, state: next };
            }
            if (input.type === 'key' && input.key === 'backspace') {
                this.deps.dispatch({ type: 'overlay.argumentsEdit', backspace: true });
                return { handled: true, state: next };
            }
            if (input.type === 'key' && input.key === 'tab') {
                const values = {
                    ...st.overlay.values,
                    [st.overlay.variables[st.overlay.selectedIndex]!]: st.overlay.editBuffer,
                };
                if (st.overlay.selectedIndex < st.overlay.variables.length - 1) {
                    this.deps.dispatch({ type: 'overlay.argumentsAdvance', values });
                } else {
                    this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'arguments', commandName: st.overlay.commandName, values });
                    this.deps.executeArgumentsCommand(st.overlay.commandName, values);
                }
                return { handled: true, state: next };
            }
        }

        if (st.overlay.type === 'commands') {
            if (input.type === 'text' && input.text.length > 0 && input.text !== 'j' && input.text !== 'k') {
                this.deps.dispatch({ type: 'overlay.commandsFilter', query: st.overlay.query + input.text });
                return { handled: true, state: next };
            }
            if (input.type === 'key' && input.key === 'backspace') {
                this.deps.dispatch({ type: 'overlay.commandsFilter', query: st.overlay.query.slice(0, -1) });
                return { handled: true, state: next };
            }
        }

        if (input.type === 'key' && input.key === 'backspace' && (st.overlay.type === 'filepicker' || st.overlay.type === 'complete')) {
            if (st.overlay.type === 'complete') {
                if (next.completeQuery.length > 0) {
                    next.completeQuery = next.completeQuery.slice(0, -1);
                    const rootDir = next.completeRootDir ?? st.overlay.currentDir;
                    next.completeRootDir = rootDir;
                    const items = this.deps.loadCompleteSearchEntries(rootDir, next.completeQuery);
                    this.deps.dispatch({ type: 'overlay.open', kind: 'complete', currentDir: rootDir, items });
                    return { handled: true, state: next };
                }
                const sel = st.overlay.items[st.overlay.selectedIndex] as { path: string; isDir: boolean } | undefined;
                if (sel?.isDir && st.overlay.expandedDirs.includes(sel.path)) {
                    this.deps.dispatch({ type: 'overlay.completeCollapse', path: sel.path });
                } else {
                    next.completeRootDir = null;
                    this.deps.dispatch({ type: 'overlay.close' });
                }
                return { handled: true, state: next };
            }

            const parent = path.dirname(st.overlay.currentDir);
            if (parent !== st.overlay.currentDir) {
                const items = this.deps.loadFilepickerEntries(parent);
                this.deps.dispatch({ type: 'overlay.filepickerGoParent', currentDir: parent, items });
            }
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'tab' && st.overlay.type === 'complete') {
            const item = st.overlay.items[st.overlay.selectedIndex] as { path: string; isDir: boolean } | undefined;
            if (!item) {
                return { handled: true, state: next };
            }
            if (item.isDir && next.completeQuery.length === 0) {
                if (st.overlay.expandedDirs.includes(item.path)) {
                    this.deps.dispatch({ type: 'overlay.completeCollapse', path: item.path });
                } else {
                    const children = this.deps.loadFilepickerEntries(item.path);
                    this.deps.dispatch({ type: 'overlay.completeExpand', path: item.path, children });
                }
            } else {
                next.completeQuery = '';
                next.completeRootDir = null;
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'complete', path: item.path });
                this.deps.appendAttachment(item.path);
            }
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'tab' && st.overlay.type === 'filepicker') {
            if (st.overlay.items.length > 0) {
                this.deps.dispatch({ type: 'overlay.move', delta: 1 });
            }
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt && st.overlay.type === 'help') {
            this.deps.dispatch({ type: 'overlay.close' });
            return { handled: true, state: next };
        }

        return { handled: false, state: next };
    }
}
