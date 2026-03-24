import type { MessagePart, TUIState, InputPart } from './tui-state.js';

type Listener = (state: TUIState) => void;

export class TUIStore {
    private state: TUIState = {
        messages: [],
        input: { parts: [{ type: 'text', content: '' }], cursorGrapheme: 0, mode: 'normal' },
        sidebar: {
            sessionId: '',
            cwd: '',
            model: '',
            agent: '',
            mode: 'BUILD',
            contextUsed: 0,
            contextMax: 200000,
            costUsdThis: 0,
            costUsdToday: 0,
            todayMessages: 0,
            lspLines: [],
        },
        status: { thinking: false, text: 'ready' },
        scroll: { offsetLines: 0, stickyBottom: true },
    };

    private readonly listeners = new Set<Listener>();

    getState(): TUIState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    addMessage(msg: TUIState['messages'][number]): void {
        this.state = {
            ...this.state,
            messages: [...this.state.messages, msg],
            scroll: { ...this.state.scroll, stickyBottom: true },
        };
        this.emit();
    }

    updateLastAssistantMessage(updater: (parts: MessagePart[]) => MessagePart[]): void {
        const messages = [...this.state.messages];
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const msg = messages[i];
            if (msg?.role !== 'assistant') {
                continue;
            }
            messages[i] = { ...msg, parts: updater(msg.parts) };
            break;
        }
        this.state = { ...this.state, messages };
        this.emit();
    }

    setThinking(thinking: boolean): void {
        this.state = { ...this.state, status: { ...this.state.status, thinking } };
        this.emit();
    }

    setInputParts(parts: InputPart[], cursorGrapheme: number): void {
        this.state = { ...this.state, input: { ...this.state.input, parts, cursorGrapheme } };
        this.emit();
    }

    setInputMode(mode: 'normal' | 'shell'): void {
        this.state = { ...this.state, input: { ...this.state.input, mode } };
        this.emit();
    }

    clearInput(): void {
        this.state = {
            ...this.state,
            input: { parts: [{ type: 'text', content: '' }], cursorGrapheme: 0, mode: 'normal' },
        };
        this.emit();
    }

    scrollBy(delta: number): void {
        const offsetLines = Math.max(0, this.state.scroll.offsetLines + delta);
        this.state = {
            ...this.state,
            scroll: {
                offsetLines,
                stickyBottom: delta > 0 && offsetLines === 0,
            },
        };
        this.emit();
    }

    scrollToBottom(): void {
        this.state = { ...this.state, scroll: { ...this.state.scroll, stickyBottom: true } };
        this.emit();
    }

    updateSidebar(update: Partial<TUIState['sidebar']>): void {
        this.state = { ...this.state, sidebar: { ...this.state.sidebar, ...update } };
        this.emit();
    }
}
