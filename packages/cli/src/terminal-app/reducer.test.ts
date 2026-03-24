import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from '../terminal-core/app-state.js';
import { reduceTerminalAppState } from './reducer.js';
import { rustTui } from '../terminal-core/rust-tui.js';

describe('terminal app reducer', () => {
    it('routes text input into the editor model and runtime events into transcript state', () => {
        let state = createInitialTerminalAppState({ width: 80, height: 24 });
        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'text', text: 'hello', raw: 'hello' },
        });

        expect(state.editor.value).toBe('hello');

        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'message.completed',
                sessionId: 'session-1',
                timestamp: 10,
                source: 'agent',
                message: {
                    id: 'assistant-1',
                    sessionId: 'session-1',
                    role: 'assistant',
                    content: 'hi there',
                    createdAt: 10,
                },
            },
        });

        expect(state.transcriptLines.join('\n')).toContain('hi there');
    });

    it('keeps highlight at the anchored row when complete overlay scrolls', () => {
        let state = createInitialTerminalAppState({ width: 120, height: 36 });
        const items = Array.from({ length: 20 }, (_, index) => ({
            path: `/tmp/item-${index}.ts`,
            label: `item-${index}.ts`,
            isDir: false,
        }));

        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'complete',
            currentDir: '/tmp',
            items,
        });

        state = reduceTerminalAppState(state, { type: 'overlay.completeScrollAt', delta: 1, anchorRow: 5 });
        state = reduceTerminalAppState(state, { type: 'overlay.completeScrollAt', delta: 1, anchorRow: 5 });

        const overlay = state.overlay;
        expect(overlay?.type).toBe('complete');
        if (!overlay || overlay.type !== 'complete') {
            throw new Error('expected complete overlay state');
        }

        expect(overlay.scrollOffset).toBe(2);
        expect(overlay.selectedIndex).toBe(7);
    });

    it('clamps complete overlay scroll and anchored selection at list boundaries', () => {
        let state = createInitialTerminalAppState({ width: 120, height: 36 });
        const items = Array.from({ length: 14 }, (_, index) => ({
            path: `/tmp/item-${index}.ts`,
            label: `item-${index}.ts`,
            isDir: false,
        }));

        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'complete',
            currentDir: '/tmp',
            items,
        });

        state = reduceTerminalAppState(state, { type: 'overlay.completeScrollAt', delta: -1, anchorRow: 4 });
        let overlay = state.overlay;
        expect(overlay?.type).toBe('complete');
        if (!overlay || overlay.type !== 'complete') {
            throw new Error('expected complete overlay state');
        }
        expect(overlay.scrollOffset).toBe(0);
        expect(overlay.selectedIndex).toBe(4);

        for (let i = 0; i < 20; i += 1) {
            state = reduceTerminalAppState(state, { type: 'overlay.completeScrollAt', delta: 1, anchorRow: 20 });
        }

        overlay = state.overlay;
        expect(overlay?.type).toBe('complete');
        if (!overlay || overlay.type !== 'complete') {
            throw new Error('expected complete overlay state');
        }
        expect(overlay.scrollOffset).toBe(6);
        expect(overlay.selectedIndex).toBe(13);
    });

    it('supports readline-style editor shortcuts from key modifiers', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'editor.set-value',
            value: 'alpha beta gamma',
            cursorOffset: 'alpha beta gamma'.length,
        });

        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'b', alt: true, raw: '\u001bb' },
        });
        expect(state.editor.cursorOffset).toBe('alpha beta '.length);

        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'w', ctrl: true, raw: '\u0017' },
        });
        expect(state.editor.value).toBe('alpha gamma');
        expect(state.editor.cursorOffset).toBe('alpha '.length);

        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'a', ctrl: true, raw: '\u0001' },
        });
        expect(state.editor.cursorOffset).toBe(0);

        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'j', ctrl: true, raw: '\u000a' },
        });
        expect(state.editor.value.startsWith('\n')).toBe(true);
    });

    it('opens help overlay with keyboard shortcut entries', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'help',
            items: [
                { key: 'Ctrl+S', description: 'Open session switcher' },
                { key: 'Ctrl+?', description: 'Open this help' },
            ],
        });

        expect(state.overlay?.type).toBe('help');
        if (!state.overlay || state.overlay.type !== 'help') {
            throw new Error('expected help overlay state');
        }
        expect(state.overlay.items).toHaveLength(2);
        expect(state.overlay.items[0]?.key).toBe('Ctrl+S');
    });

    it('filters command overlay items by / query', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'commands',
            items: [
                { id: 'session', label: 'Switch Session', description: 'restore session' },
                { id: 'model', label: 'Select Model', description: 'pick model' },
            ],
        });
        state = reduceTerminalAppState(state, { type: 'overlay.commandsFilter', query: 'sess' });

        expect(state.overlay?.type).toBe('commands');
        if (!state.overlay || state.overlay.type !== 'commands') {
            throw new Error('expected commands overlay state');
        }
        expect(state.overlay.items).toHaveLength(1);
        expect(state.overlay.items[0]?.id).toBe('session');
        expect(state.overlay.emptyText).toBeUndefined();

        state = reduceTerminalAppState(state, { type: 'overlay.commandsFilter', query: 'zzz' });
        if (!state.overlay || state.overlay.type !== 'commands') {
            throw new Error('expected commands overlay state');
        }
        expect(state.overlay.items).toHaveLength(0);
        expect(state.overlay.emptyText).toBe('No commands match "/zzz"');
    });

    it('restores filepicker cursor when going back to parent', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'filepicker',
            currentDir: '/root',
            items: [
                { path: '/root/a', label: 'a/', isDir: true },
                { path: '/root/b', label: 'b/', isDir: true },
            ],
        });
        state = reduceTerminalAppState(state, { type: 'overlay.move', delta: 1 });
        state = reduceTerminalAppState(state, {
            type: 'overlay.filepickerEnterDir',
            currentDir: '/root/b',
            items: [{ path: '/root/b/c', label: 'c/', isDir: true }],
        });
        state = reduceTerminalAppState(state, {
            type: 'overlay.filepickerGoParent',
            currentDir: '/root',
            items: [
                { path: '/root/a', label: 'a/', isDir: true },
                { path: '/root/b', label: 'b/', isDir: true },
            ],
        });

        expect(state.overlay?.type).toBe('filepicker');
        if (!state.overlay || state.overlay.type !== 'filepicker') {
            throw new Error('expected filepicker overlay state');
        }
        expect(state.overlay.selectedIndex).toBe(1);
        expect(state.overlay.history).toHaveLength(0);
    });

    it('applies theme selection when closing the overlay stack', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 }, { themeId: 'default' });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'commands',
            items: [{ id: 'palette', label: 'Palette' }],
        });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'theme',
            items: [
                { id: 'default', label: 'Default' },
                { id: 'light', label: 'Light' },
            ],
        });

        state = reduceTerminalAppState(state, { type: 'overlay.closeWithSelect', kind: 'theme', id: 'light' });

        expect(state.themeId).toBe('light');
        expect(state.overlay?.type).toBe('commands');
        expect(state.overlayStack).toHaveLength(0);
    });

    it('deletes last attachment pill on backspace at text start', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'editor.append-attachment',
            attachment: { id: 'pill-1', label: '@src/a.ts', kind: 'file', path: '/repo/src/a.ts' },
        });
        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'backspace', raw: '\u0008' },
        });

        expect(state.editor.attachments).toHaveLength(0);
    });

    it('deletes first attachment pill on delete at part start', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'editor.append-attachment',
            attachment: { id: 'pill-1', label: '@src/a.ts', kind: 'file', path: '/repo/src/a.ts' },
        });
        state = reduceTerminalAppState(state, {
            type: 'editor.append-attachment',
            attachment: { id: 'pill-2', label: '@src/b.ts', kind: 'file', path: '/repo/src/b.ts' },
        });
        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'home', raw: '' },
        });
        state = reduceTerminalAppState(state, {
            type: 'input',
            input: { type: 'key', key: 'delete', raw: '' },
        });

        expect(state.editor.attachments).toHaveLength(1);
        expect(state.editor.attachments[0]?.id).toBe('pill-2');
    });

    it('closes overlays by stack priority (top first)', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'commands',
            items: [{ id: 'session', label: 'Session' }],
        });
        state = reduceTerminalAppState(state, {
            type: 'overlay.open',
            kind: 'filepicker',
            currentDir: '/tmp',
            items: [{ path: '/tmp/a.ts', label: 'a.ts', isDir: false }],
        });

        expect(state.overlay?.type).toBe('filepicker');
        expect(state.overlayStack).toHaveLength(1);

        state = reduceTerminalAppState(state, { type: 'overlay.close' });
        expect(state.overlay?.type).toBe('commands');
        expect(state.overlayStack).toHaveLength(0);

        state = reduceTerminalAppState(state, { type: 'overlay.close' });
        expect(state.overlay).toBeNull();
    });

    it('toggles diff context per block id', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, { type: 'diff.context.toggle', blockId: 'b1' });
        expect(state.diffExpandedBlockIds).toContain('b1');

        state = reduceTerminalAppState(state, { type: 'diff.context.toggle', blockId: 'b1' });
        expect(state.diffExpandedBlockIds).not.toContain('b1');
    });

    it('toggles context group expansion by entry id', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, { type: 'context.group.toggle', entryId: 's1:tool:read_file:1:context-group:3' });
        expect(state.expandedContextGroupIds).toContain('s1:tool:read_file:1:context-group:3');

        state = reduceTerminalAppState(state, { type: 'context.group.toggle', entryId: 's1:tool:read_file:1:context-group:3' });
        expect(state.expandedContextGroupIds).not.toContain('s1:tool:read_file:1:context-group:3');
    });

    it('toggles interaction mode and advances runtime pulse on timer', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        expect(state.interactionMode).toBe('build');

        state = reduceTerminalAppState(state, { type: 'interaction.mode.toggle' });
        expect(state.interactionMode).toBe('plan');

        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'status.changed',
                sessionId: 's1',
                timestamp: 1,
                source: 'runtime',
                status: 'running-tool',
            },
        });
        state = reduceTerminalAppState(state, { type: 'timer', timerId: 'runtime-pulse', now: Date.now() });
        expect(state.runtimePulseFrame).toBe(1);
    });

    it('removes attachment pill independently from editor text', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, { type: 'editor.set-value', value: '你好🙂', cursorOffset: '你好🙂'.length });
        state = reduceTerminalAppState(state, {
            type: 'editor.append-attachment',
            attachment: { id: 'pill-1', label: '@src/main.ts', kind: 'file', path: '/repo/src/main.ts' },
        });

        state = reduceTerminalAppState(state, { type: 'editor.remove-last-attachment' });
        expect(state.editor.attachments).toHaveLength(0);
        expect(state.editor.value).toBe('你好🙂');
    });

    it('accepts ui-local tool feedback without forging runtime domain events', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'ui.tool.feedback.called',
            sessionId: 'session-1',
            timestamp: 10,
            tool: 'workflow',
            args: { name: 'deploy' },
        });
        state = reduceTerminalAppState(state, {
            type: 'ui.tool.feedback.output',
            sessionId: 'session-1',
            timestamp: 11,
            tool: 'workflow',
            output: 'step 1/4',
        });
        state = reduceTerminalAppState(state, {
            type: 'ui.tool.feedback.completed',
            sessionId: 'session-1',
            timestamp: 12,
            tool: 'workflow',
            success: true,
            metadata: { workflow: 'deploy' },
        });

        expect(state.transcriptLines.join('\n')).toContain('workflow');
        expect(state.notice).toContain('ok');
    });

    it('keeps approval/question domain facts separate from ui input state', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'approval.requested',
                sessionId: 'session-1',
                timestamp: 20,
                source: 'agent',
                requestId: 'approval-1',
                kind: 'tool.use',
                summary: 'Need permission',
            },
        });
        state = reduceTerminalAppState(state, { type: 'approval.menu.move', selectedIndex: 2 });

        expect(state.pendingApproval?.summary).toBe('Need permission');
        expect(state.approvalInput?.selectedIndex).toBe(2);

        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'question.requested',
                sessionId: 'session-1',
                timestamp: 21,
                source: 'agent',
                requestId: 'question-1',
                question: 'Pick mode',
                options: [{ label: 'Parity' }, { label: 'Speed' }],
                multiple: false,
                allowCustom: true,
            },
        });
        state = reduceTerminalAppState(state, { type: 'question.menu.move', selectedIndex: 1 });
        state = reduceTerminalAppState(state, { type: 'question.custom.append', text: 'x' });

        expect(state.pendingQuestion?.question).toBe('Pick mode');
        expect(state.questionInput).toEqual({
            selectedIndex: 1,
            selected: ['Parity'],
            customText: 'x',
        });
    });

    it('keeps runtime notices separate from ui notices and lets runtime replace stale ui hints', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'status.changed',
                sessionId: 'session-1',
                timestamp: 1,
                source: 'runtime',
                status: 'thinking',
            },
        });

        expect(state.runtimeNotice).toBe('thinking');
        expect(state.uiNotice).toBeUndefined();
        expect(state.notice).toBe('thinking');

        state = reduceTerminalAppState(state, { type: 'notice.set', notice: 'Copied path: /repo/src/app.ts' });

        expect(state.runtimeNotice).toBe('thinking');
        expect(state.uiNotice).toBe('Copied path: /repo/src/app.ts');
        expect(state.notice).toBe('Copied path: /repo/src/app.ts');

        state = reduceTerminalAppState(state, {
            type: 'runtime',
            event: {
                type: 'approval.requested',
                sessionId: 'session-1',
                timestamp: 2,
                source: 'agent',
                requestId: 'approval-1',
                kind: 'tool.use',
                summary: 'Need permission',
            },
        });

        expect(state.uiNotice).toBeUndefined();
        expect(state.runtimeNotice).toBe('Need permission');
        expect(state.notice).toBe('Need permission');
    });

    it('routes chat viewport intents through rust scroll state', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = {
            ...state,
            transcriptLines: Array.from({ length: 200 }, (_, index) => `line-${index}`),
        };

        const controller = rustTui as unknown as {
            messageScrollBy: (delta: number) => void;
            messageScrollOffsetLines: () => number;
            messageScrollStickyBottom: () => boolean;
        };
        const original = {
            messageScrollBy: controller.messageScrollBy,
            messageScrollOffsetLines: controller.messageScrollOffsetLines,
            messageScrollStickyBottom: controller.messageScrollStickyBottom,
        };

        let topLine = 10;
        let stickyBottom = false;
        controller.messageScrollBy = (delta) => {
            topLine = Math.max(0, topLine + delta);
        };
        controller.messageScrollOffsetLines = () => topLine;
        controller.messageScrollStickyBottom = () => stickyBottom;

        try {
            state = reduceTerminalAppState(state, { type: 'viewport.scroll', delta: 5 });
            expect(state.viewport.scrollOffset).toBe(15);
            expect(state.viewport.isFollowingBottom).toBe(false);

            stickyBottom = true;
            state = reduceTerminalAppState(state, { type: 'viewport.scroll', delta: -3 });
            expect(state.viewport.scrollOffset).toBe(12);
            expect(state.viewport.isFollowingBottom).toBe(true);
        } finally {
            controller.messageScrollBy = original.messageScrollBy;
            controller.messageScrollOffsetLines = original.messageScrollOffsetLines;
            controller.messageScrollStickyBottom = original.messageScrollStickyBottom;
        }
    });

    it('keeps chat scrollOffset stable across resize', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });

        const controller = rustTui as unknown as {
            messageScrollOffsetLines: () => number;
            messageScrollStickyBottom: () => boolean;
        };

        const original = {
            messageScrollOffsetLines: controller.messageScrollOffsetLines,
            messageScrollStickyBottom: controller.messageScrollStickyBottom,
        };

        let topLine = 17;
        let stickyBottom = false;

        controller.messageScrollOffsetLines = () => topLine;
        controller.messageScrollStickyBottom = () => stickyBottom;

        try {
            state = reduceTerminalAppState(state, { type: 'resize', size: { width: 120, height: 40 } });
            expect(state.viewport.scrollOffset).toBe(17);
            expect(state.viewport.isFollowingBottom).toBe(false);

            // change size again, but keep rust answers stable
            state = reduceTerminalAppState(state, { type: 'resize', size: { width: 90, height: 25 } });
            expect(state.viewport.scrollOffset).toBe(17);
            expect(state.viewport.isFollowingBottom).toBe(false);

            stickyBottom = true;
            state = reduceTerminalAppState(state, { type: 'resize', size: { width: 110, height: 26 } });
            expect(state.viewport.scrollOffset).toBe(17);
            expect(state.viewport.isFollowingBottom).toBe(true);
        } finally {
            controller.messageScrollOffsetLines = original.messageScrollOffsetLines;
            controller.messageScrollStickyBottom = original.messageScrollStickyBottom;
        }
    });

    it('delegates chat jump and scrollbar intents to rust viewport intent application', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = {
            ...state,
            transcriptLines: Array.from({ length: 200 }, (_, index) => `line-${index}`),
        };

        const controller = rustTui as unknown as {
            applyMessageViewportIntent: (intent: unknown) => void;
            queryMessageViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
            computeLayout: (cols: number, rows: number, inputLines: number) => { messages?: { height?: number } } | null;
        };

        const original = {
            applyMessageViewportIntent: controller.applyMessageViewportIntent,
            queryMessageViewport: controller.queryMessageViewport,
            computeLayout: controller.computeLayout,
        };

        let topLine = 10;
        const intents: unknown[] = [];
        controller.applyMessageViewportIntent = (intent) => {
            intents.push(intent);
            if ((intent as { kind?: string }).kind === 'jump') {
                topLine = 74;
            }
            if ((intent as { kind?: string }).kind === 'scrollbar') {
                topLine = 41;
            }
        };
        controller.queryMessageViewport = () => ({
            scrollOffset: topLine,
            isFollowingBottom: false,
        });
        controller.computeLayout = () => ({
            messages: { height: 20 },
        });

        try {
            state = reduceTerminalAppState(state, {
                type: 'viewport.intent.jump',
                targetLine: 80,
                anchorNumerator: 1,
                anchorDenominator: 3,
            });

            expect(intents[0]).toMatchObject({
                kind: 'jump',
                lineCount: 200,
                height: 20,
                targetLine: 80,
                anchorNumerator: 1,
                anchorDenominator: 3,
            });
            expect(state.viewport.scrollOffset).toBe(74);

            state = reduceTerminalAppState(state, {
                type: 'viewport.intent.scrollbar',
                pointerRow: 12,
                dragOffset: 2,
            });

            expect(intents[1]).toMatchObject({
                kind: 'scrollbar',
                lineCount: 200,
                height: 20,
                pointerRow: 12,
                dragOffset: 2,
            });
            expect(state.viewport.scrollOffset).toBe(41);
        } finally {
            controller.applyMessageViewportIntent = original.applyMessageViewportIntent;
            controller.queryMessageViewport = original.queryMessageViewport;
            controller.computeLayout = original.computeLayout;
        }
    });

    it('falls back to computed chat layout height for page scroll when viewport projection is missing', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = {
            ...state,
            viewport: { ...state.viewport, viewportHeight: 0 },
        };

        const controller = rustTui as unknown as {
            applyMessageViewportIntent: (intent: unknown) => void;
            computeLayout: (cols: number, rows: number, inputLines: number) => { messages?: { height?: number } } | null;
            queryMessageViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
        };

        const original = {
            applyMessageViewportIntent: controller.applyMessageViewportIntent,
            computeLayout: controller.computeLayout,
            queryMessageViewport: controller.queryMessageViewport,
        };

        const intents: unknown[] = [];
        controller.applyMessageViewportIntent = (intent) => {
            intents.push(intent);
        };
        controller.computeLayout = () => ({
            messages: { height: 12 },
        });
        controller.queryMessageViewport = () => ({
            scrollOffset: 0,
            isFollowingBottom: false,
        });

        try {
            state = reduceTerminalAppState(state, { type: 'viewport.page', direction: 'up' });
            expect(intents[0]).toMatchObject({ kind: 'page', direction: 'up', pageSize: 10 });
        } finally {
            controller.applyMessageViewportIntent = original.applyMessageViewportIntent;
            controller.computeLayout = original.computeLayout;
            controller.queryMessageViewport = original.queryMessageViewport;
        }
    });

    it('routes log viewport projection and intents through rust log scroll state', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = {
            ...state,
            page: 'logs',
            logLines: Array.from({ length: 120 }, (_, index) => `log-${index}`),
        };

        const controller = rustTui as unknown as {
            refreshLogViewport: (logLines: string[], contentWidth: number, viewportHeight: number) => void;
            applyLogViewportIntent: (intent: unknown) => void;
            queryLogViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
            computeLayout: (cols: number, rows: number, inputLines: number) => { messages?: { height?: number; width?: number } } | null;
        };

        const original = {
            refreshLogViewport: controller.refreshLogViewport,
            applyLogViewportIntent: controller.applyLogViewportIntent,
            queryLogViewport: controller.queryLogViewport,
            computeLayout: controller.computeLayout,
        };

        const refreshCalls: Array<{ lines: number; contentWidth: number; height: number }> = [];
        const intents: unknown[] = [];
        let topLine = 14;
        let stickyBottom = false;

        controller.refreshLogViewport = (logLines, contentWidth, viewportHeight) => {
            refreshCalls.push({ lines: logLines.length, contentWidth, height: viewportHeight });
        };
        controller.applyLogViewportIntent = (intent) => {
            intents.push(intent);
            if ((intent as { kind?: string }).kind === 'delta') {
                topLine = 19;
            }
            if ((intent as { kind?: string }).kind === 'page') {
                topLine = 2;
            }
            if ((intent as { kind?: string }).kind === 'end') {
                topLine = 88;
                stickyBottom = true;
            }
        };
        controller.queryLogViewport = () => ({
            scrollOffset: topLine,
            isFollowingBottom: stickyBottom,
        });
        controller.computeLayout = () => ({
            messages: { height: 20, width: 82 },
        });

        try {
            state = reduceTerminalAppState(state, { type: 'logViewport.scroll', delta: 5 });
            expect(refreshCalls[0]).toEqual({ lines: 120, contentWidth: 80, height: 20 });
            expect(intents[0]).toMatchObject({ kind: 'delta', delta: 5 });
            expect(state.logViewport.scrollOffset).toBe(19);
            expect(state.logViewport.viewportHeight).toBe(20);

            state = reduceTerminalAppState(state, { type: 'logViewport.page', direction: 'up' });
            expect(intents[1]).toMatchObject({ kind: 'page', direction: 'up', pageSize: 17 });
            expect(state.logViewport.scrollOffset).toBe(2);

            state = reduceTerminalAppState(state, { type: 'logViewport.end' });
            expect(intents[2]).toMatchObject({ kind: 'end' });
            expect(state.logViewport.scrollOffset).toBe(88);
            expect(state.logViewport.isFollowingBottom).toBe(true);
        } finally {
            controller.refreshLogViewport = original.refreshLogViewport;
            controller.applyLogViewportIntent = original.applyLogViewportIntent;
            controller.queryLogViewport = original.queryLogViewport;
            controller.computeLayout = original.computeLayout;
        }
    });

    it('falls back to computed log layout height for page scroll when log viewport projection is missing', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });
        state = {
            ...state,
            page: 'logs',
            logLines: Array.from({ length: 120 }, (_, index) => `log-${index}`),
            logViewport: { ...state.logViewport, viewportHeight: 0 },
        };

        const controller = rustTui as unknown as {
            refreshLogViewport: (logLines: string[], contentWidth: number, viewportHeight: number) => void;
            applyLogViewportIntent: (intent: unknown) => void;
            queryLogViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
            computeLayout: (cols: number, rows: number, inputLines: number) => { messages?: { height?: number; width?: number } } | null;
        };

        const original = {
            refreshLogViewport: controller.refreshLogViewport,
            applyLogViewportIntent: controller.applyLogViewportIntent,
            queryLogViewport: controller.queryLogViewport,
            computeLayout: controller.computeLayout,
        };

        const intents: unknown[] = [];
        controller.refreshLogViewport = () => undefined;
        controller.applyLogViewportIntent = (intent) => {
            intents.push(intent);
        };
        controller.queryLogViewport = () => ({
            scrollOffset: 0,
            isFollowingBottom: false,
        });
        controller.computeLayout = () => ({
            messages: { height: 18, width: 82 },
        });

        try {
            state = reduceTerminalAppState(state, { type: 'logViewport.page', direction: 'up' });
            expect(intents[0]).toMatchObject({ kind: 'page', direction: 'up', pageSize: 15 });
        } finally {
            controller.refreshLogViewport = original.refreshLogViewport;
            controller.applyLogViewportIntent = original.applyLogViewportIntent;
            controller.queryLogViewport = original.queryLogViewport;
            controller.computeLayout = original.computeLayout;
        }
    });

    it('reprojects chat viewport from rust on session lifecycle and page return', () => {
        let state = createInitialTerminalAppState({ width: 100, height: 30 });

        const controller = rustTui as unknown as {
            queryMessageViewport: () => { scrollOffset: number; isFollowingBottom: boolean };
            computeLayout: (cols: number, rows: number, inputLines: number) => { messages?: { height?: number } } | null;
        };

        const original = {
            queryMessageViewport: controller.queryMessageViewport,
            computeLayout: controller.computeLayout,
        };

        let topLine = 33;
        let stickyBottom = false;
        let viewportHeight = 18;
        controller.queryMessageViewport = () => ({
            scrollOffset: topLine,
            isFollowingBottom: stickyBottom,
        });
        controller.computeLayout = () => ({
            messages: { height: viewportHeight },
        });

        try {
            state = reduceTerminalAppState(state, { type: 'session.new' });
            expect(state.viewport.scrollOffset).toBe(33);
            expect(state.viewport.isFollowingBottom).toBe(false);
            expect(state.viewport.viewportHeight).toBe(18);

            state = reduceTerminalAppState(state, { type: 'page.toggle' });
            expect(state.page).toBe('logs');
            topLine = 38;
            stickyBottom = false;
            viewportHeight = 19;
            state = reduceTerminalAppState(state, { type: 'viewport.sync' });
            expect(state.viewport.scrollOffset).toBe(38);
            expect(state.viewport.isFollowingBottom).toBe(false);
            expect(state.viewport.viewportHeight).toBe(19);

            topLine = 44;
            stickyBottom = true;
            viewportHeight = 21;
            state = reduceTerminalAppState(state, { type: 'page.toggle' });
            expect(state.page).toBe('chat');
            expect(state.viewport.scrollOffset).toBe(44);
            expect(state.viewport.isFollowingBottom).toBe(true);
            expect(state.viewport.viewportHeight).toBe(21);

            topLine = 27;
            stickyBottom = false;
            viewportHeight = 16;
            state = reduceTerminalAppState(state, {
                type: 'session.restored',
                sessionId: 'session-1',
                title: 'Recovered',
                messages: [{ role: 'assistant', content: 'hello again' }] as any,
            });
            expect(state.viewport.scrollOffset).toBe(27);
            expect(state.viewport.isFollowingBottom).toBe(false);
            expect(state.viewport.viewportHeight).toBe(16);
        } finally {
            controller.queryMessageViewport = original.queryMessageViewport;
            controller.computeLayout = original.computeLayout;
        }
    });
});
