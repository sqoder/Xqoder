import type { TerminalInputEvent } from '../terminal-core/input-parser.js';
import { MouseEditorController } from './mouse-editor-controller.js';
import { MouseTranscriptController } from './mouse-transcript-controller.js';

interface MouseSelectionControllerDeps {
    dispatch: (event: unknown) => void;
    renderNow: () => Promise<unknown>;
    stdout: NodeJS.WriteStream;
}

export class MouseSelectionController {
    private readonly editorController: MouseEditorController;
    private readonly transcriptController: MouseTranscriptController;

    constructor(private readonly deps: MouseSelectionControllerDeps) {
        this.editorController = new MouseEditorController({
            dispatch: deps.dispatch,
        });
        this.transcriptController = new MouseTranscriptController({
            dispatch: deps.dispatch,
            renderNow: deps.renderNow,
            stdout: deps.stdout,
        });
    }

    handle(input: TerminalInputEvent, st: any): boolean {
        if (this.editorController.handle(input, st)) {
            return true;
        }
        return this.transcriptController.handle(input, st);
    }

    clearSelectionAnchor(): void {
        this.transcriptController.clearSelectionAnchor();
    }
}
