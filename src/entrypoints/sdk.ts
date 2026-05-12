// P26 — SDK entrypoint: headless programmatic API for XQoder.
//
// Provides a clean `run(opts)` AsyncIterable interface for third-party
// integrations. Each yielded item is a ConversationEventEnvelope.

import type { ConversationEventEnvelope } from '@xqoder/protocol';
import { runChatMessageStream } from '../application/chat/run-chat.js';
import { createDefaultChatSessionStore } from '../infrastructure/storage/index.js';

export interface RunOptions {
    /** The user prompt to send. */
    prompt: string;
    /** Working directory (defaults to process.cwd()). */
    cwd?: string;
    /** Model override. */
    model?: string;
    /** Agent name override. */
    agent?: string;
    /** Session ID to resume. */
    sessionId?: string;
    /** Start a new session even if sessionId is provided. */
    newSession?: boolean;
    /** Maximum number of turns. */
    maxTurns?: number;
    /** Abort signal to cancel the run. */
    signal?: AbortSignal;
    /** Disable session persistence. */
    noSessionPersistence?: boolean;
}

export type SdkEvent = ConversationEventEnvelope;

export interface RunResult {
    response: string;
    sessionId: string;
}

/**
 * Run a single prompt and yield ConversationEventEnvelopes as they arrive.
 *
 * Usage:
 * ```ts
 * import { run } from '@xqoder/sdk';
 * for await (const event of run({ prompt: 'Hello', cwd: '/my/project' })) {
 *     if (event.type === 'message.delta') process.stdout.write(event.payload.text);
 * }
 * ```
 */
export async function* run(opts: RunOptions): AsyncGenerator<SdkEvent, RunResult, undefined> {
    const cwd = opts.cwd ?? process.cwd();
    const events: SdkEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;
    let finalResult: RunResult | null = null;
    let streamError: Error | null = null;

    // Run the chat stream in the background, buffering events
    const streamPromise = runChatMessageStream(
        {
            prompt: opts.prompt,
            cwd,
            model: opts.model,
            agent: opts.agent,
            sessionId: opts.sessionId,
            startNewSession: opts.newSession ?? !opts.sessionId,
            shouldPersistSession: !opts.noSessionPersistence,
            autoApproveTools: false,
            entrypoint: 'headless',
            signal: opts.signal,
            onEvent: (event) => {
                events.push(event);
                resolveNext?.();
                resolveNext = null;
            },
        },
        { createSessionStore: createDefaultChatSessionStore },
    ).then((result) => {
        finalResult = result;
    }).catch((err: Error) => {
        streamError = err;
    }).finally(() => {
        done = true;
        resolveNext?.();
        resolveNext = null;
    });

    // Yield events as they arrive
    while (true) {
        if (events.length > 0) {
            yield events.shift()!;
            continue;
        }

        if (done) break;

        // Wait for the next event or completion
        await new Promise<void>((resolve) => {
            resolveNext = resolve;
            // If events arrived between the check and the promise creation, resolve immediately
            if (events.length > 0 || done) resolve();
        });
    }

    // Drain any remaining buffered events
    while (events.length > 0) {
        yield events.shift()!;
    }

    await streamPromise;

    if (streamError) throw streamError;

    return finalResult ?? { response: '', sessionId: '' };
}
