import { createInterface } from 'node:readline/promises';
import type { AgentCallbacks, ToolApprovalRequest } from '@xqoder/agent';

type ApprovalCategory = NonNullable<ToolApprovalRequest['category']>;

export interface ApprovalDetails {
    title: string;
    riskLabel?: string;
    explanation?: string;
    suggestion?: string;
}

const KNOWN_CATEGORIES = new Set<ApprovalCategory>([
    'outside-workspace-read',
    'sensitive-read',
    'protected-path',
    'high-risk-write',
    'dangerous-command',
    'network',
    'external-tool',
    'suspicious-path',
    'internal-runtime',
    'policy',
]);

export function createCliToolApprovalHandler(): AgentCallbacks['onToolApproval'] | undefined {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return async () => true;
    }

    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    let approveAll = false;

    return async (request: ToolApprovalRequest): Promise<boolean> => {
        if (approveAll) {
            return true;
        }

        const details = describeApprovalRequest(request);
        process.stdout.write('\n');
        process.stdout.write(`[Tool Approval] ${details.title}\n`);
        if (details.riskLabel) {
            process.stdout.write(`Risk: ${details.riskLabel}\n`);
        }
        if (details.explanation) {
            process.stdout.write(`Why: ${details.explanation}\n`);
        }
        process.stdout.write(`${request.summary}\n`);
        if (request.reason) {
            process.stdout.write(`${request.reason}\n`);
        }
        if (request.preview) {
            process.stdout.write('\n');
            process.stdout.write(`${request.preview}\n`);
        }
        if (details.suggestion) {
            process.stdout.write(`Suggestion: ${details.suggestion}\n`);
        }

        const answer = (await readline.question('Approve execution? [y]es / [n]o / [a]ll: '))
            .trim()
            .toLowerCase();

        if (answer === 'a' || answer === 'all') {
            approveAll = true;
            return true;
        }

        return answer === 'y' || answer === 'yes';
    };
}

export function createCliToolStreamHandler(): AgentCallbacks['onToolStream'] {
    return (_name, chunk) => {
        process.stdout.write(chunk);
    };
}

export function describeApprovalRequest(request: ToolApprovalRequest): ApprovalDetails {
    const category = classifyApprovalRequest(request);
    return {
        title: renderApprovalTitle(category),
        riskLabel: renderRiskLabel(request.risk),
        explanation: renderApprovalExplanation(category),
        suggestion: normalizeSuggestion(request.suggestion),
    };
}

function classifyApprovalRequest(request: ToolApprovalRequest): ApprovalCategory {
    if (isKnownApprovalCategory(request.category)) {
        return request.category;
    }

    const haystack = [request.summary, request.reason, request.preview]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n')
        .toLowerCase();

    if (haystack.includes('suspicious path')) {
        return 'suspicious-path';
    }

    if (haystack.includes('read outside workspace')) {
        return 'outside-workspace-read';
    }

    if (haystack.includes('sensitive file') || haystack.includes('sensitive data')) {
        return 'sensitive-read';
    }

    if (haystack.includes('protected path')) {
        return 'protected-path';
    }

    if (haystack.includes('high-risk config path') || haystack.includes('review write before prior read')) {
        return 'high-risk-write';
    }

    if (haystack.includes('dangerous') || haystack.includes('execute command:') || request.toolName === 'run_shell' || request.toolName === 'run_command') {
        return 'dangerous-command';
    }

    if (request.toolName === 'fetch_url' || request.toolName === 'websearch') {
        return 'network';
    }

    if (request.toolName.startsWith('mcp.') || haystack.includes('mcp server') || haystack.includes('mcp tool')) {
        return 'external-tool';
    }

    return 'policy';
}

function isKnownApprovalCategory(value: ToolApprovalRequest['category']): value is ApprovalCategory {
    return typeof value === 'string' && KNOWN_CATEGORIES.has(value as ApprovalCategory);
}

function renderApprovalTitle(category: ApprovalCategory): string {
    switch (category) {
        case 'outside-workspace-read':
            return 'Read outside workspace';
        case 'sensitive-read':
            return 'Sensitive read';
        case 'protected-path':
            return 'Protected path access';
        case 'high-risk-write':
            return 'High-risk write';
        case 'dangerous-command':
            return 'Shell command approval';
        case 'network':
            return 'Network access';
        case 'external-tool':
            return 'External tool access';
        case 'suspicious-path':
            return 'Suspicious path access';
        case 'internal-runtime':
            return 'Internal runtime access';
        case 'policy':
        default:
            return 'Manual approval required';
    }
}

function renderApprovalExplanation(category: ApprovalCategory): string | undefined {
    switch (category) {
        case 'outside-workspace-read':
            return 'This read reaches beyond the current workspace, so it needs explicit approval.';
        case 'sensitive-read':
            return 'This read may expose secrets, local credentials, shell configuration, or agent settings.';
        case 'protected-path':
            return 'This target path affects protected configuration or machine-local state.';
        case 'high-risk-write':
            return 'This write could change important configuration or modify files outside the normal edit flow.';
        case 'dangerous-command':
            return 'This shell command can change system or repository state and should be reviewed before running.';
        case 'network':
            return 'This operation reaches a network resource outside the local workspace.';
        case 'external-tool':
            return 'This operation comes from an external tool or MCP server and is not treated as trusted local workspace access.';
        case 'suspicious-path':
            return 'This path uses a suspicious pattern such as shell expansion, indirection, or another form that can hide the real target.';
        case 'internal-runtime':
            return 'This access targets an internal runtime path managed by the agent session.';
        case 'policy':
        default:
            return 'The current permission policy requires an explicit decision before this tool can run.';
    }
}

function renderRiskLabel(risk: ToolApprovalRequest['risk']): string | undefined {
    if (!risk) {
        return undefined;
    }

    switch (risk) {
        case 'high':
            return 'high';
        case 'medium':
            return 'medium';
        case 'low':
            return 'low';
        default:
            return undefined;
    }
}

function normalizeSuggestion(suggestion: string | undefined): string | undefined {
    const normalized = suggestion?.trim();
    return normalized ? normalized : undefined;
}
