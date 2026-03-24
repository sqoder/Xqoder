type InterruptState = 'idle' | 'cancelling_llm' | 'exiting';

type InterruptSource = 'sigint' | 'ctrl_c_key' | 'ctrl_c_byte';

interface InterruptManagerOptions {
    isLLMRunning: () => boolean;
    onCancelLLM: () => Promise<void> | void;
    onExit: () => void;
}

export class InterruptManager {
    private state: InterruptState = 'idle';
    private readonly options: InterruptManagerOptions;
    private registered = false;
    private readonly onSigInt = (): void => {
        this.handle('sigint');
    };

    constructor(options: InterruptManagerOptions) {
        this.options = options;
    }

    register(): void {
        if (this.registered) {
            return;
        }
        this.registered = true;
        process.on('SIGINT', this.onSigInt);
        process.on('SIGTERM', this.onSigInt);
    }

    unregister(): void {
        if (!this.registered) {
            return;
        }
        this.registered = false;
        process.off('SIGINT', this.onSigInt);
        process.off('SIGTERM', this.onSigInt);
    }

    onCtrlCByte(): void {
        this.handle('ctrl_c_byte');
    }

    onCtrlCKey(): void {
        this.handle('ctrl_c_key');
    }

    private handle(_source: InterruptSource): void {
        if (this.state !== 'idle') {
            return;
        }

        if (this.options.isLLMRunning()) {
            this.state = 'cancelling_llm';
            Promise.resolve(this.options.onCancelLLM())
                .catch(() => {})
                .finally(() => {
                    this.state = 'idle';
                });
            return;
        }

        this.state = 'exiting';
        this.options.onExit();
    }
}
