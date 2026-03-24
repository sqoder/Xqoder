import * as path from 'node:path';
import { copyTarget, copyViewportSelection, resolveViewportCopyTarget } from '../terminal-core/copy-action.js';
import { getClipboardService, writeToClipboardOSC52 } from '../terminal-core/clipboard.js';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';

interface CopySelectionControllerDeps {
    dispatch: (event: unknown) => void;
    renderNow: () => Promise<unknown>;
    parsePatchedPathFromLine: (line: string) => string | undefined;
    stdout: NodeJS.WriteStream;
}

export class CopySelectionController {
    constructor(private readonly deps: CopySelectionControllerDeps) {}

    private copyTextWithToast(text: string, toastText: string, ttl = 5000): void {
        const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        writeToClipboardOSC52(text, this.deps.stdout);
        getClipboardService().writeText(text).then(() => {
            this.deps.dispatch({ type: 'toast.push', id: toastId, text: toastText, kind: 'success', ttl });
            this.deps.renderNow();
            setTimeout(() => this.deps.dispatch({ type: 'toast.dismiss', id: toastId }), ttl);
        }).catch(() => {
            this.deps.dispatch({ type: 'toast.push', id: toastId, text: toastText, kind: 'success', ttl });
            this.deps.renderNow();
            setTimeout(() => this.deps.dispatch({ type: 'toast.dismiss', id: toastId }), ttl);
        });
    }

    private copySelectionText(st: any): boolean {
        return copyViewportSelection(
            st.transcriptLines,
            st.viewport.selectedRange,
            getClipboardService(),
            (event) => this.deps.dispatch(event),
            () => this.deps.renderNow(),
            this.deps.stdout,
            { ttl: 5000, clearSelectionOnEmpty: false },
        );
    }

    handle(input: TerminalInputEvent, st: any, defaultDir: string): boolean {
        if (
            input.type === 'key'
            && input.key === 'c'
            && (input.alt || (input.ctrl && input.shift))
            && !(input.ctrl && input.alt)
        ) {
            if (this.copySelectionText(st)) {
                return true;
            }
            const target = resolveViewportCopyTarget(st, 'visible-code-block');
            if (target) {
                void copyTarget(st, target, getClipboardService(), (event) => this.deps.dispatch(event), this.deps.stdout).then(() =>
                    this.deps.renderNow(),
                );
            }
            return true;
        }

        if (input.type === 'key' && input.key === 'y' && !input.ctrl && !input.alt) {
            if (this.copySelectionText(st)) {
                return true;
            }
            const focusedLine = st.viewport.anchorMessageId;
            const focusedText = focusedLine != null ? (st.transcriptLines[focusedLine] ?? '') : '';
            const focusedPatchedPath = this.deps.parsePatchedPathFromLine(focusedText);
            if (focusedPatchedPath) {
                const baseDir = st.cwd ?? defaultDir;
                const resolvedPath = path.isAbsolute(focusedPatchedPath)
                    ? path.normalize(focusedPatchedPath)
                    : path.resolve(baseDir, focusedPatchedPath);
                this.copyTextWithToast(resolvedPath, 'Copied patched path');
                this.deps.dispatch({ type: 'notice.set', notice: `Copied path: ${focusedPatchedPath}` });
                return true;
            }
            const target = resolveViewportCopyTarget(st, input.shift ? 'visible-code-block' : 'latest-assistant');
            if (target) {
                void copyTarget(st, target, getClipboardService(), (event) => this.deps.dispatch(event), this.deps.stdout).then(() =>
                    this.deps.renderNow(),
                );
            }
            return true;
        }

        return false;
    }
}
