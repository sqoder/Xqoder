import type { TerminalSize } from './types.js';
import type { TerminalCoreEvent, TerminalSubscription } from './types.js';

export interface TerminalEventLoopOptions<State> {
    initialState: State;
    reduce(state: State, event: TerminalCoreEvent): State;
    render(state: State): void;
}

export class TerminalEventLoop<State> {
    private state: State;
    private readonly listeners = new Set<(state: State) => void>();
    private renderScheduled = false;

    constructor(private readonly options: TerminalEventLoopOptions<State>) {
        this.state = options.initialState;
        options.render(options.initialState);
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

    async renderNow(): Promise<void> {
        this.options.render(this.state);
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
