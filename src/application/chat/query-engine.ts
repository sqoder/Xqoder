// P09 sub-PR 4: QueryEngine facade.
//
// submitMessage(input) is the OpenClaude-aligned canonical entry point. It
// wraps createConversationTurnStream — the existing streaming implementation
// runConversationTurn/streamConversationTurn already delegate to — so the
// legacy signatures remain stable while new callers get a class seam.
//
// The class is a thin binding; heavy logic still lives in query-loop.ts and
// the envelope stream factory in conversation-engine.ts.

import type { ConversationEventEnvelope } from '@xqoder/protocol';
import {
    runConversationTurn,
    streamConversationTurn,
    type ConversationEngineDependencies,
    type ConversationEngineResult,
} from './conversation-engine.js';

export interface QueryEngineInput {
    readonly dependencies: ConversationEngineDependencies;
}

export class QueryEngine {
    submitMessage(input: QueryEngineInput): AsyncIterable<ConversationEventEnvelope> {
        return streamConversationTurn(input.dependencies);
    }

    runTurn(input: QueryEngineInput): Promise<ConversationEngineResult> {
        return runConversationTurn(input.dependencies);
    }
}

export function createQueryEngine(): QueryEngine {
    return new QueryEngine();
}
