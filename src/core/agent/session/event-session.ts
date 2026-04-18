/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    type AgentProtocol,
    type AgentSend,
    type AgentEvent,
    type Unsubscribe,
} from '../protocol.js';

/**
 * EventSession is a wrapper around AgentProtocol that provides a more
 * convenient API for consuming agent activity as an AsyncIterable.
 * 
 * Ported from Gemini CLI's AgentSession architecture.
 */
export class EventSession implements AgentProtocol {
    private _protocol: AgentProtocol;

    constructor(protocol: AgentProtocol) {
        this._protocol = protocol;
    }

    async send(payload: AgentSend): Promise<{ streamId: string | null }> {
        return this._protocol.send(payload);
    }

    subscribe(callback: (event: AgentEvent) => void): Unsubscribe {
        return this._protocol.subscribe(callback);
    }

    async abort(): Promise<void> {
        return this._protocol.abort();
    }

    get events(): readonly AgentEvent[] {
        return this._protocol.events;
    }

    /**
     * Sends a payload to the agent and returns an AsyncIterable that yields
     * events for the resulting stream.
     */
    async *sendStream(payload: AgentSend): AsyncIterable<AgentEvent> {
        const result = await this._protocol.send(payload);
        const streamId = result.streamId;

        if (streamId === null) {
            return;
        }

        yield* this.stream({ streamId });
    }

    /**
     * Returns an AsyncIterable that yields events from the agent session.
     */
    async *stream(
        options: {
            streamId?: string;
        } = {},
    ): AsyncIterable<AgentEvent> {
        let resolve: (() => void) | undefined;
        let next = new Promise<void>((res) => {
            resolve = res;
        });

        let eventQueue: AgentEvent[] = [];
        const earlyEvents: AgentEvent[] = [];
        let done = false;
        let trackedStreamId = options.streamId;
        let started = false;
        let agentActivityStarted = false;

        const queueVisibleEvent = (event: AgentEvent): void => {
            if (trackedStreamId && event.streamId !== trackedStreamId) {
                return;
            }

            if (!agentActivityStarted) {
                if (event.type !== 'agent_start') {
                    return;
                }
                trackedStreamId = event.streamId;
                agentActivityStarted = true;
            }

            if (!trackedStreamId) {
                return;
            }

            eventQueue.push(event);
            if (event.type === 'agent_end' && event.streamId === trackedStreamId) {
                done = true;
            }
        };

        const unsubscribe = this._protocol.subscribe((event) => {
            if (done) return;

            if (!started) {
                earlyEvents.push(event);
                return;
            }

            queueVisibleEvent(event);

            const currentResolve = resolve;
            next = new Promise<void>((r) => {
                resolve = r;
            });
            currentResolve?.();
        });

        try {
            started = true;
            // Process events that arrived while we were setting up
            for (const event of earlyEvents) {
                if (done) break;
                queueVisibleEvent(event);
            }

            while (true) {
                if (eventQueue.length > 0) {
                    const eventsToYield = eventQueue;
                    eventQueue = [];
                    for (const event of eventsToYield) {
                        yield event;
                    }
                    continue;
                }

                if (done) break;
                await next;
            }
        } finally {
            unsubscribe();
        }
    }
}
