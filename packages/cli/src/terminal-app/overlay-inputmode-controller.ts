import * as fs from 'node:fs';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';

interface OverlayInputModeControllerDeps {
    dispatch: (event: unknown) => void;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    resolveFilepickerInputPath: (currentDir: string, target: string) => string;
    appendAttachment: (resolvedPath: string) => void;
    setNotice: (notice: string) => void;
}

interface OverlayRuntimeState {
    completeQuery: string;
    completeRootDir: string | null;
}

export class OverlayInputModeController {
    constructor(private readonly deps: OverlayInputModeControllerDeps) {}

    handle(input: TerminalInputEvent, st: any, runtime: OverlayRuntimeState): { handled: boolean; state: OverlayRuntimeState } {
        const next = { ...runtime };
        if (!(st.overlay.type === 'filepicker' && st.overlay.inputMode)) {
            return { handled: false, state: next };
        }

        if (input.type === 'text') {
            this.deps.dispatch({ type: 'overlay.filepickerPathEdit', append: input.text });
            return { handled: true, state: next };
        }
        if (input.type === 'key' && input.key === 'backspace') {
            this.deps.dispatch({ type: 'overlay.filepickerPathEdit', backspace: true });
            return { handled: true, state: next };
        }
        if (input.type === 'key' && input.key === 'escape') {
            this.deps.dispatch({ type: 'overlay.filepickerInputMode', enabled: false });
            return { handled: true, state: next };
        }
        if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
            const target = st.overlay.pathBuffer.trim();
            if (!target) {
                this.deps.setNotice('Path is empty');
                this.deps.dispatch({ type: 'overlay.filepickerInputMode', enabled: false });
                return { handled: true, state: next };
            }
            const resolved = this.deps.resolveFilepickerInputPath(st.overlay.currentDir, target);
            if (!fs.existsSync(resolved)) {
                this.deps.setNotice(`Path not found: ${target} (try ./, ../, ~/, or absolute path)`);
                return { handled: true, state: next };
            }
            const stat = fs.statSync(resolved);
            if (stat.isDirectory()) {
                const items = this.deps.loadFilepickerEntries(resolved);
                this.deps.dispatch({ type: 'overlay.filepickerEnterDir', currentDir: resolved, items });
            } else {
                this.deps.dispatch({ type: 'overlay.closeWithSelect', kind: 'filepicker', path: resolved });
                this.deps.appendAttachment(resolved);
            }
            return { handled: true, state: next };
        }

        return { handled: false, state: next };
    }
}
