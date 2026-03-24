import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { rustTui } from '../terminal-core/rust-tui.js';
import { buildExternalEditorHint, openInExternalEditor, resolveExternalEditor } from './terminal-runtime.js';

type VimMode = 'insert' | 'normal';

interface EditorKeyRuntime {
    vimMode: VimMode;
    sawFollowUpAfterEnter: boolean;
    enterSubmitTimer: ReturnType<typeof setTimeout> | null;
}

interface EditorKeyDeps {
    dispatch: (event: unknown) => void;
    renderNow: () => Promise<unknown>;
    getState: () => any;
    settingsDir: string;
    parsePatchedPathFromLine: (line: string) => string | undefined;
    loadFilepickerEntries: (dir: string) => Array<{ path: string; label: string; isDir: boolean }>;
    readClipboard: () => string | undefined;
    showPasteHint: (text: string) => void;
    submitEditor: () => Promise<void>;
    setEnterSubmitTimer: (timer: ReturnType<typeof setTimeout> | null) => void;
    stdout: NodeJS.WriteStream;
    enterSubmitDelayMs: number;
}

export class EditorKeyController {
    constructor(private readonly deps: EditorKeyDeps) {}

    private setVimMode(runtime: EditorKeyRuntime, mode: VimMode): EditorKeyRuntime {
        if (runtime.vimMode === mode) {
            return runtime;
        }
        this.deps.dispatch({
            type: 'notice.set',
            notice: mode === 'normal'
                ? '-- NORMAL -- (i: insert, h/j/k/l: move, x: delete, 0/$: line start/end)'
                : '-- INSERT --',
        });
        return { ...runtime, vimMode: mode };
    }

    handle(input: TerminalInputEvent, runtime: EditorKeyRuntime): { handled: boolean; state: EditorKeyRuntime } {
        let next = { ...runtime };
        const currentState = this.deps.getState();

        if (!currentState.overlay && input.type === 'key' && input.key === 'e' && input.ctrl && !input.alt) {
            const currentText = currentState.editor.value;
            this.deps.dispatch({ type: 'notice.set', notice: buildExternalEditorHint(resolveExternalEditor()) });
            void this.deps.renderNow();
            const edited = openInExternalEditor(currentText, this.deps.stdout);
            if (edited.error) {
                this.deps.dispatch({ type: 'notice.set', notice: `Editor failed: ${edited.error}` });
            } else if (edited.value != null) {
                this.deps.dispatch({ type: 'editor.set-value', value: edited.value });
                this.deps.dispatch({ type: 'notice.set', notice: 'Loaded content from external editor' });
            }
            next = this.setVimMode(next, 'insert');
            return { handled: true, state: next };
        }

        if (!currentState.overlay && input.type === 'key' && input.key === ']' && input.ctrl && !input.alt) {
            next = this.setVimMode(next, next.vimMode === 'insert' ? 'normal' : 'insert');
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'v' && input.alt && !input.ctrl) {
            const content = this.deps.readClipboard();
            if (content) {
                const normalized = content.replace(/\r\n?/g, '\n');
                this.deps.dispatch({ type: 'input', input: { type: 'paste', text: normalized, raw: '' } });
                if (!normalized.includes('\n')) {
                    this.deps.showPasteHint(normalized);
                }
            }
            return { handled: true, state: next };
        }

        if (!currentState.overlay && input.type === 'text' && input.text === '!' && currentState.editor.value.trim().length === 0) {
            this.deps.dispatch({ type: 'notice.set', notice: 'Shell mode enabled (!)' });
            return { handled: false, state: next };
        }

        if (!currentState.overlay && input.type === 'key' && input.key === 'escape' && currentState.editor.value.trimStart().startsWith('!')) {
            const withoutBang = currentState.editor.value.replace(/^\s*!\s?/, '');
            this.deps.dispatch({ type: 'editor.set-value', value: withoutBang, cursorOffset: 0 });
            this.deps.dispatch({ type: 'notice.set', notice: 'Shell mode disabled' });
            return { handled: true, state: next };
        }

        if (next.vimMode === 'normal') {
            if (input.type === 'key' && input.key === 'escape') {
                return { handled: true, state: next };
            }
            if (input.type === 'text') {
                if (input.text === 'i') {
                    next = this.setVimMode(next, 'insert');
                    return { handled: true, state: next };
                }
                if (input.text === 'a') {
                    this.deps.dispatch({ type: 'input', input: { type: 'key', key: 'right', raw: '' } });
                    next = this.setVimMode(next, 'insert');
                    return { handled: true, state: next };
                }
                if (input.text === 'h' || input.text === 'j' || input.text === 'k' || input.text === 'l') {
                    const key = input.text === 'h' ? 'left' : input.text === 'j' ? 'down' : input.text === 'k' ? 'up' : 'right';
                    this.deps.dispatch({ type: 'input', input: { type: 'key', key, raw: '' } });
                    return { handled: true, state: next };
                }
                if (input.text === '0' || input.text === '$') {
                    this.deps.dispatch({ type: 'input', input: { type: 'key', key: input.text === '0' ? 'home' : 'end', raw: '' } });
                    return { handled: true, state: next };
                }
                if (input.text === 'x') {
                    this.deps.dispatch({ type: 'input', input: { type: 'key', key: 'delete', raw: '' } });
                    return { handled: true, state: next };
                }
                if (input.text === 'o') {
                    this.deps.dispatch({ type: 'input', input: { type: 'key', key: 'end', raw: '' } });
                    this.deps.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
                    next = this.setVimMode(next, 'insert');
                    return { handled: true, state: next };
                }
            }
            if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
                return { handled: true, state: next };
            }
        }

        if (input.type === 'key' && input.key === 'enter' && !input.ctrl && !input.alt) {
            const st = this.deps.getState();
            const focusedLine = st.viewport.anchorMessageId;
            const focusedText = focusedLine != null ? (st.transcriptLines[focusedLine] ?? '') : '';
            const focusedPatchedPath = this.deps.parsePatchedPathFromLine(focusedText);
            const focusedDiffBlock = focusedLine != null
                ? st.transcriptCodeBlocks.find((b: any) => focusedLine >= b.startLine && focusedLine <= b.endLine && (b.language || '').toLowerCase() === 'diff')
                : undefined;
            const onFoldedMarker = rustTui.isFoldedDiffMarker(focusedText.trim());
            const blockExpanded = focusedDiffBlock ? st.diffExpandedBlockIds.includes(focusedDiffBlock.id) : false;

            if (focusedDiffBlock && (onFoldedMarker || blockExpanded) && st.editor.value.trim().length === 0 && !st.pendingApproval && !st.pendingQuestion && !st.overlay) {
                this.deps.dispatch({ type: 'diff.context.toggle', blockId: focusedDiffBlock.id });
                return { handled: true, state: next };
            }

            if (focusedPatchedPath && st.editor.value.trim().length === 0 && !st.pendingApproval && !st.pendingQuestion && !st.overlay) {
                const baseDir = st.cwd ?? this.deps.settingsDir;
                const resolvedPath = path.isAbsolute(focusedPatchedPath)
                    ? path.normalize(focusedPatchedPath)
                    : path.resolve(baseDir, focusedPatchedPath);
                let jumpDir = path.dirname(resolvedPath);
                try {
                    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
                        jumpDir = resolvedPath;
                    }
                } catch {
                    // keep dirname fallback
                }
                const items = this.deps.loadFilepickerEntries(jumpDir);
                this.deps.dispatch({ type: 'overlay.open', kind: 'filepicker', currentDir: jumpDir, items });
                const targetIndex = items.findIndex((item) => path.resolve(item.path) === path.resolve(resolvedPath));
                if (targetIndex > 0) {
                    for (let i = 0; i < targetIndex; i += 1) {
                        this.deps.dispatch({ type: 'overlay.move', delta: 1 });
                    }
                }
                this.deps.dispatch({ type: 'notice.set', notice: `Jumped to ${focusedPatchedPath}` });
                return { handled: true, state: next };
            }

            if (next.sawFollowUpAfterEnter) {
                this.deps.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
            } else {
                next.enterSubmitTimer = setTimeout(() => {
                    this.deps.setEnterSubmitTimer(null);
                    void this.deps.submitEditor();
                }, this.deps.enterSubmitDelayMs);
                this.deps.setEnterSubmitTimer(next.enterSubmitTimer);
            }
            return { handled: true, state: next };
        }

        if (input.type === 'key' && input.key === 'enter' && (input.shift || input.ctrl || input.alt)) {
            this.deps.dispatch({ type: 'input', input: { type: 'text', text: '\n', raw: '\n' } });
            return { handled: true, state: next };
        }

        return { handled: false, state: next };
    }
}
