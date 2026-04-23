export interface FormattedSessionUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cost?: number;
}

export function formatSessionUsageSummary(usage: FormattedSessionUsage): string {
    const segments = [
        `prompt=${usage.promptTokens}`,
        `completion=${usage.completionTokens}`,
        `total=${usage.totalTokens}`,
    ];

    if (typeof usage.cacheReadTokens === 'number' && usage.cacheReadTokens > 0) {
        segments.push(`cacheRead=${usage.cacheReadTokens}`);
    }

    if (typeof usage.cacheCreationTokens === 'number' && usage.cacheCreationTokens > 0) {
        segments.push(`cacheCreate=${usage.cacheCreationTokens}`);
    }

    if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
        segments.push(`cost=${formatSessionUsageCost(usage.cost)}`);
    }

    return segments.join(', ');
}

export function formatSessionUsageCost(cost: number): string {
    if (!Number.isFinite(cost)) {
        return 'n/a';
    }

    if (cost === 0) {
        return '$0.00';
    }

    if (Math.abs(cost) >= 0.01) {
        return `$${cost.toFixed(2)}`;
    }

    if (Math.abs(cost) >= 0.001) {
        return `$${cost.toFixed(4)}`;
    }

    return `$${cost.toFixed(6)}`;
}
