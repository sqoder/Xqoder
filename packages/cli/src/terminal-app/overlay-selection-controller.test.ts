import { describe, expect, it, vi } from 'vitest';
import { OverlaySelectionController } from './overlay-selection-controller.js';

describe('OverlaySelectionController', () => {
    function createController() {
        const dispatch = vi.fn<(event: unknown) => void>();
        const loadKnownModelsForProvider = vi.fn((provider: string) => [{ id: `${provider}-m1`, label: `${provider}-m1` }]);
        const loadFilepickerEntries = vi.fn((dir: string) => [{ path: `${dir}/child`, label: 'child', isDir: false }]);
        const appendAttachment = vi.fn(() => true);
        const recordCompleteSelection = vi.fn();
        const executeArgumentsCommand = vi.fn();
        const onSelectSession = vi.fn();
        const onSelectModel = vi.fn();
        const onSelectTheme = vi.fn();
        const onSelectInit = vi.fn();
        const onSelectCommand = vi.fn();
        const onDismissInit = vi.fn();

        const controller = new OverlaySelectionController({
            dispatch,
            loadKnownModelsForProvider,
            loadFilepickerEntries,
            appendAttachment,
            recordCompleteSelection,
            executeArgumentsCommand,
            onSelectSession,
            onSelectModel,
            onSelectTheme,
            onSelectInit,
            onSelectCommand,
            onDismissInit,
        });

        return {
            controller,
            dispatch,
            loadKnownModelsForProvider,
            appendAttachment,
            recordCompleteSelection,
            executeArgumentsCommand,
            onSelectModel,
            onDismissInit,
        };
    }

    it('switches provider in model overlay with right key', () => {
        const { controller, dispatch, loadKnownModelsForProvider } = createController();
        const result = controller.handle(
            { type: 'key', key: 'right', raw: '' },
            {
                overlay: {
                    type: 'model',
                    providers: ['p1', 'p2'],
                    providerIndex: 0,
                    items: [{ id: 'p1-m1', label: 'p1-m1' }],
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(loadKnownModelsForProvider).toHaveBeenCalledWith('p2');
        expect(dispatch).toHaveBeenCalledWith({
            type: 'overlay.modelSetProvider',
            providerIndex: 1,
            items: [{ id: 'p2-m1', label: 'p2-m1' }],
        });
    });

    it('submits arguments overlay on last variable enter', () => {
        const { controller, dispatch, executeArgumentsCommand } = createController();
        const result = controller.handle(
            { type: 'key', key: 'enter', raw: '' },
            {
                overlay: {
                    type: 'arguments',
                    commandName: 'my-cmd',
                    variables: ['name'],
                    selectedIndex: 0,
                    values: {},
                    editBuffer: 'alice',
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'overlay.closeWithSelect',
            kind: 'arguments',
            commandName: 'my-cmd',
            values: { name: 'alice' },
        });
        expect(executeArgumentsCommand).toHaveBeenCalledWith('my-cmd', { name: 'alice' });
    });

    it('selects file item in filepicker and appends attachment', () => {
        const { controller, dispatch, appendAttachment } = createController();
        const result = controller.handle(
            { type: 'key', key: 'enter', raw: '' },
            {
                overlay: {
                    type: 'filepicker',
                    selectedIndex: 0,
                    items: [{ path: '/tmp/a.txt', label: 'a.txt', isDir: false }],
                },
            },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.closeWithSelect', kind: 'filepicker', path: '/tmp/a.txt' });
        expect(appendAttachment).toHaveBeenCalledWith('/tmp/a.txt');
    });

    it('dismisses init overlay on escape text input', () => {
        const { controller, dispatch, onDismissInit } = createController();
        const result = controller.handle(
            { type: 'text', text: '\u001b', raw: '\u001b' },
            { overlay: { type: 'init', selectedIndex: 0, items: [] } },
            { completeQuery: '', completeRootDir: null },
        );

        expect(result.handled).toBe(true);
        expect(onDismissInit).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.close' });
    });

    it('records complete selection before appending attachment', () => {
        const { controller, dispatch, appendAttachment, recordCompleteSelection } = createController();
        const result = controller.handle(
            { type: 'key', key: 'enter', raw: '' },
            {
                overlay: {
                    type: 'complete',
                    selectedIndex: 0,
                    currentDir: '/tmp',
                    expandedDirs: [],
                    scrollOffset: 0,
                    items: [{ path: '/tmp/a.txt', label: 'a.txt', isDir: false }],
                },
            },
            { completeQuery: 'a', completeRootDir: '/tmp' },
        );

        expect(result.handled).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'overlay.closeWithSelect', kind: 'complete', path: '/tmp/a.txt' });
        expect(recordCompleteSelection).toHaveBeenCalledWith('/tmp/a.txt');
        expect(appendAttachment).toHaveBeenCalledWith('/tmp/a.txt');
    });
});
