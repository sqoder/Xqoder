import { calculateCost } from './model-costs.js';

export interface CostResult {
    usd: number;
    cny: number;
    formatted: string;
}

export interface CostUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
}

// 简化：固定汇率（Week4 可改成可配置/实时）
export const DEFAULT_CNY_RATE = 7.2;

export class CostCalculator {
    constructor(private readonly cnyRate: number = DEFAULT_CNY_RATE) {}

    calculate(model: string, inputTokens: number, outputTokens: number, extras?: Pick<CostUsage, 'cacheReadTokens' | 'cacheCreationTokens'>): CostResult {
        const usd = calculateCost(model, {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            cacheReadTokens: extras?.cacheReadTokens,
            cacheCreationTokens: extras?.cacheCreationTokens,
        });
        const cny = usd * this.cnyRate;
        return {
            usd,
            cny,
            formatted: `¥${cny.toFixed(2)}`,
        };
    }
}

