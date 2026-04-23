import { AgentError } from '@xqoder/shared';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';
export type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

export interface ConversationEngineResult {
    response: string;
    stopReason: ConversationStopReason;
    iterations: number;
    toolCallCount: number;
}

export class ConversationEngineStopError extends AgentError {
    readonly stopReason: Exclude<ConversationStopReason, 'completed' | 'user_cancelled'>;
    readonly agentEndReason: 'failed' | 'error';

    constructor(
        message: string,
        options: {
            stopReason: ConversationEngineStopError['stopReason'];
            agentEndReason: ConversationEngineStopError['agentEndReason'];
        },
    ) {
        super(message);
        this.name = 'ConversationEngineStopError';
        this.stopReason = options.stopReason;
        this.agentEndReason = options.agentEndReason;
    }
}
