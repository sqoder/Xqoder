import type { ToolCall } from '@xqoder/shared';
import type { CompletionRequest, ILLMProvider } from './base.js';
import type {
    ConversationProviderEvent,
    ConversationProviderEventStream,
} from './provider-events.js';

export interface StreamProviderEventsParams {
    provider: ILLMProvider;
    request: CompletionRequest;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
    private readonly values: T[] = [];
    private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
    private closed = false;

    push(value: T): void {
        if (this.closed) {
            return;
        }

        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value, done: false });
            return;
        }

        this.values.push(value);
    }

    close(): void {
        this.closed = true;
        while (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            waiter?.({ value: undefined, done: true });
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: () => {
                const value = this.values.shift();
                if (value !== undefined) {
                    return Promise.resolve({ value, done: false });
                }

                if (this.closed) {
                    return Promise.resolve({ value: undefined, done: true });
                }

                return new Promise<IteratorResult<T>>((resolve) => {
                    this.waiters.push(resolve);
                });
            },
        };
    }
}

export function streamProviderEvents(
    params: StreamProviderEventsParams,
): ConversationProviderEventStream {
    const events = new AsyncEventQueue<ConversationProviderEvent>();
    const emittedToolCalls = new Set<string>();
    let errorEmitted = false;
    let emittedDataEvent = false;

    const pushEvent = (event: ConversationProviderEvent): void => {
        if (event.type !== 'error') {
            emittedDataEvent = true;
        }
        events.push(event);
    };

    const pushToolCall = (toolCall: ToolCall): void => {
        const key = getToolCallKey(toolCall);
        if (emittedToolCalls.has(key)) {
            return;
        }
        emittedToolCalls.add(key);
        pushEvent({
            type: 'tool',
            toolCall: { ...toolCall },
        });
    };

    const emitTerminalResponse = (response: Awaited<ReturnType<ILLMProvider['complete']>>): void => {
        for (const toolCall of response.message.toolCalls ?? []) {
            pushToolCall(toolCall);
        }

        pushEvent({
            type: 'usage',
            usage: { ...response.usage },
        });
        pushEvent({
            type: 'stop',
            message: response.message,
            finishReason: response.finishReason,
        });
    };

    const canFallbackToComplete = (): boolean => typeof params.provider.complete === 'function';
    const canInvokeStream = (): boolean => typeof params.provider.stream === 'function';

    const completed = (async () => {
        try {
            if (canInvokeStream()) {
                try {
                    const response = await params.provider.stream(params.request, {
                        onToken: (text) => {
                            pushEvent({ type: 'message', text });
                        },
                        onThinkingToken: (text) => {
                            pushEvent({ type: 'reasoning', text });
                        },
                        onToolCall: (toolCall) => {
                            pushToolCall(toolCall);
                        },
                        onError: (error) => {
                            if (errorEmitted) {
                                return;
                            }
                            errorEmitted = true;
                            events.push({ type: 'error', error });
                        },
                    });

                    emitTerminalResponse(response);
                    return;
                } catch (error) {
                    const normalizedError = toError(error);
                    if (!emittedDataEvent && !errorEmitted && canFallbackToComplete()) {
                        const response = await params.provider.complete(params.request);
                        emitTerminalResponse(response);
                        return;
                    }

                    if (!errorEmitted) {
                        errorEmitted = true;
                        events.push({ type: 'error', error: normalizedError });
                    }
                    throw normalizedError;
                }
            }

            if (canFallbackToComplete()) {
                const response = await params.provider.complete(params.request);
                emitTerminalResponse(response);
                return;
            }

            throw new Error('Provider does not support stream() or complete()');
        } catch (error) {
            const normalizedError = toError(error);
            if (!errorEmitted) {
                errorEmitted = true;
                events.push({ type: 'error', error: normalizedError });
            }
            throw normalizedError;
        } finally {
            events.close();
        }
    })();

    return {
        events,
        completed,
    };
}

function getToolCallKey(toolCall: ToolCall): string {
    return toolCall.id || `${toolCall.name}:${toolCall.arguments}`;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
