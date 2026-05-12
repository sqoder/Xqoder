import type { LLMMessage, ToolDefinition } from '@xqoder/shared';
import type { ILLMProvider } from '../../../shared/llm-api/base.js';
import type { ClassifierResult, ClassifierUsage } from './types.js';

export interface LlmClassifyInput {
    command: string;
    transcriptTail: LLMMessage[];
    providerStage1: ILLMProvider;
    providerStage2?: ILLMProvider;
    signal?: AbortSignal;
    budgetTokens?: number;
}

const DEFAULT_BUDGET = 512;

const CLASSIFIER_SYSTEM_PROMPT = [
    'You are a security classifier for shell commands invoked by an AI coding agent.',
    'Decide whether the command should be blocked from running. Block commands that:',
    '- modify or destroy data outside the current workspace',
    '- exfiltrate secrets, credentials, or local machine identity',
    '- escalate privileges (sudo, su, chmod root)',
    '- mutate shared infrastructure (force-push, publish to registries, deploy to prod)',
    '- pipe remote content directly into an interpreter',
    '',
    'Allow commands that only read project state or run local build/test/lint.',
    'When unsure, block.',
    'Reply by calling the `classify_result` tool exactly once.',
].join('\n');

const CLASSIFY_TOOL: ToolDefinition = {
    name: 'classify_result',
    description: 'Return whether the shell command should be blocked.',
    parameters: [
        {
            name: 'block',
            type: 'boolean',
            description: 'True if the command should be blocked, false if it should be allowed.',
            required: true,
        },
        {
            name: 'reason',
            type: 'string',
            description: 'One-sentence justification for the decision.',
            required: true,
        },
    ],
};

export async function classifyByLlm(input: LlmClassifyInput): Promise<ClassifierResult> {
    const stage1 = await requestClassification(input.providerStage1, input);

    if (stage1.kind === 'error') {
        return {
            decision: 'deny',
            reason: `Classifier stage 1 ${stage1.error}`,
            source: stage1.error === 'timeout' ? 'llm-timeout' : 'llm-unavailable',
            ...(stage1.usage ? { stage1Usage: stage1.usage } : {}),
            model: input.providerStage1.model,
        };
    }

    if (stage1.kind === 'unparsed') {
        return {
            decision: 'deny',
            reason: 'Classifier stage 1 returned unparseable output; blocking for safety.',
            source: 'llm-stage1',
            ...(stage1.usage ? { stage1Usage: stage1.usage } : {}),
            model: input.providerStage1.model,
        };
    }

    if (!stage1.block) {
        return {
            decision: 'allow',
            reason: stage1.reason,
            source: 'llm-stage1',
            ...(stage1.usage ? { stage1Usage: stage1.usage } : {}),
            model: input.providerStage1.model,
        };
    }

    const providerStage2 = input.providerStage2 ?? input.providerStage1;
    const stage2 = await requestClassification(providerStage2, input);

    const stage1Usage = stage1.usage;
    const stage2Usage = stage2.kind === 'error' || stage2.kind === 'unparsed' ? stage2.usage : stage2.usage;

    if (stage2.kind === 'error') {
        return {
            decision: 'deny',
            reason: `Classifier stage 2 ${stage2.error}; blocking for safety.`,
            source: stage2.error === 'timeout' ? 'llm-timeout' : 'llm-unavailable',
            ...(stage1Usage ? { stage1Usage } : {}),
            ...(stage2Usage ? { stage2Usage } : {}),
            model: providerStage2.model,
        };
    }

    if (stage2.kind === 'unparsed') {
        return {
            decision: 'deny',
            reason: 'Classifier stage 2 returned unparseable output; blocking for safety.',
            source: 'llm-stage2',
            ...(stage1Usage ? { stage1Usage } : {}),
            ...(stage2Usage ? { stage2Usage } : {}),
            model: providerStage2.model,
        };
    }

    return {
        decision: stage2.block ? 'deny' : 'allow',
        reason: stage2.reason,
        source: 'llm-stage2',
        ...(stage1Usage ? { stage1Usage } : {}),
        ...(stage2Usage ? { stage2Usage } : {}),
        model: providerStage2.model,
    };
}

type RequestOutcome =
    | { kind: 'parsed'; block: boolean; reason: string; usage?: ClassifierUsage }
    | { kind: 'unparsed'; usage?: ClassifierUsage }
    | { kind: 'error'; error: 'timeout' | 'unavailable'; usage?: ClassifierUsage };

async function requestClassification(
    provider: ILLMProvider,
    input: LlmClassifyInput,
): Promise<RequestOutcome> {
    const budget = input.budgetTokens ?? DEFAULT_BUDGET;
    const messages = buildClassifierMessages(input.command, input.transcriptTail);

    let response;
    try {
        response = await provider.complete({
            messages,
            tools: [CLASSIFY_TOOL],
            maxTokens: budget,
            temperature: 0,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        const error: 'timeout' | 'unavailable' = message.includes('timeout') || message.includes('timed out')
            ? 'timeout'
            : 'unavailable';
        return { kind: 'error', error };
    }

    const usage: ClassifierUsage | undefined = response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
        }
        : undefined;

    const toolCalls = response.message.toolCalls ?? [];
    const classifyCall = toolCalls.find((call) => call.name === 'classify_result');

    if (!classifyCall) {
        return { kind: 'unparsed', ...(usage ? { usage } : {}) };
    }

    const parsed = parseClassifyArgs(classifyCall.arguments);
    if (!parsed) {
        return { kind: 'unparsed', ...(usage ? { usage } : {}) };
    }

    return { kind: 'parsed', block: parsed.block, reason: parsed.reason, ...(usage ? { usage } : {}) };
}

function buildClassifierMessages(command: string, transcriptTail: LLMMessage[]): LLMMessage[] {
    const transcript = transcriptTail.slice(-4);
    const userContent = [
        'Command to classify:',
        '```',
        command,
        '```',
        transcript.length > 0
            ? 'Recent conversation context (most recent last):'
            : 'No prior conversation context.',
        ...transcript.map((msg) => {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return `- [${msg.role}] ${content.slice(0, 400)}`;
        }),
    ].join('\n');

    return [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
    ];
}

function parseClassifyArgs(args: unknown): { block: boolean; reason: string } | null {
    let parsed: unknown = args;
    if (typeof args === 'string') {
        try {
            parsed = JSON.parse(args);
        } catch {
            return null;
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        return null;
    }

    const record = parsed as Record<string, unknown>;
    const block = record['block'];
    const reason = record['reason'];

    if (typeof block !== 'boolean' || typeof reason !== 'string') {
        return null;
    }

    return { block, reason };
}
