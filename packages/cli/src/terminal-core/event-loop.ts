import { ScreenBuffer, type TerminalSize } from './screen-buffer.js';
import type { TerminalCoreEvent, TerminalRenderResult, TerminalSubscription, TerminalWriter } from './types.js';

export interface TerminalEventLoopOptions<State> {
    initialState: State;
    reduce(state: State, event: TerminalCoreEvent): State;
    render(state: State): TerminalRenderResult;
    writer: TerminalWriter;
}

export class TerminalEventLoop<State> {
    private state: State;
    private currentFrame: ScreenBuffer;
    private readonly listeners = new Set<(state: State) => void>();
    private renderScheduled = false;

    constructor(private readonly options: TerminalEventLoopOptions<State>) {
        this.state = options.initialState;
        const initialFrame = options.render(options.initialState);
        this.currentFrame = ScreenBuffer.empty({ width: initialFrame.buffer.width, height: initialFrame.buffer.height });
    }

    getState(): State {
        return this.state;
    }

    subscribe(listener: (state: State) => void): TerminalSubscription<State> {
        this.listeners.add(listener);
        return {
            getState: () => this.state,
            unsubscribe: () => {
                this.listeners.delete(listener);
            },
        };
    }

    dispatch(event: TerminalCoreEvent): void {
        this.state = this.options.reduce(this.state, event);
        for (const listener of this.listeners) {
            listener(this.state);
        }
        this.scheduleRender();
    }

    resize(size: TerminalSize): void {
        this.dispatch({ type: 'resize', size });
    }

    async renderNow(): Promise<TerminalRenderResult> {
        const nextFrame = this.options.render(this.state);
        const result = {
            buffer: nextFrame.buffer,
            patches: this.currentFrame.diff(nextFrame.buffer),
            cursor: nextFrame.cursor,
        };
        this.currentFrame = nextFrame.buffer;
        await this.options.writer.write(result);
        return result;
    }

    private scheduleRender(): void {
        if (this.renderScheduled) {
            return;
        }
        this.renderScheduled = true;
        queueMicrotask(() => {
            this.renderScheduled = false;
            void this.renderNow();
        });
    }
}
