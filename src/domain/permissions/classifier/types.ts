export type ShellDecision = 'allow' | 'ask' | 'deny';

export type ClassifierSource =
    | 'rule-safe'
    | 'rule-dangerous'
    | 'llm-stage1'
    | 'llm-stage2'
    | 'llm-unavailable'
    | 'llm-timeout'
    | 'fallback'
    | 'denial-tracked';

export interface ClassifierUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ClassifierResult {
    decision: ShellDecision;
    reason: string;
    source: ClassifierSource;
    stage1Usage?: ClassifierUsage;
    stage2Usage?: ClassifierUsage;
    model?: string;
}
