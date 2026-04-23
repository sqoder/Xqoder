import type { AgentSessionUsage } from './session-types.js';
import { readNumber } from './session-utils.js';
export {
    formatSessionUsageCost,
    formatSessionUsageSummary,
} from '../../../shared/session-usage.js';

export type SessionUsageShape = Pick<
    AgentSessionUsage,
    'promptTokens' | 'completionTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'cost'
>;

type OptionalSessionUsage = Partial<Pick<
    AgentSessionUsage,
    'cacheReadTokens' | 'cacheCreationTokens' | 'cost'
>>;

export function serializeOptionalSessionUsage(
    usage: Pick<AgentSessionUsage, 'cacheReadTokens' | 'cacheCreationTokens' | 'cost'>,
): OptionalSessionUsage {
    const serialized: OptionalSessionUsage = {};

    if (typeof usage.cacheReadTokens === 'number' && Number.isFinite(usage.cacheReadTokens) && usage.cacheReadTokens > 0) {
        serialized.cacheReadTokens = usage.cacheReadTokens;
    }

    if (
        typeof usage.cacheCreationTokens === 'number'
        && Number.isFinite(usage.cacheCreationTokens)
        && usage.cacheCreationTokens > 0
    ) {
        serialized.cacheCreationTokens = usage.cacheCreationTokens;
    }

    if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
        serialized.cost = usage.cost;
    }

    return serialized;
}

export function readOptionalSessionUsage(value: unknown): OptionalSessionUsage {
    const source = typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : undefined;
    const cacheReadTokens = readNumber(source?.['cacheReadTokens']);
    const cacheCreationTokens = readNumber(source?.['cacheCreationTokens']);
    const cost = readNumber(source?.['cost']);

    return {
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
        ...(cost !== undefined ? { cost } : {}),
    };
}
