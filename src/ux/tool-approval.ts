import { createInterface } from 'node:readline/promises';
import type { AgentCallbacks, ToolApprovalRequest } from '@xqoder/agent';

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

        process.stdout.write('\n');
        process.stdout.write(`[Tool Approval] ${request.summary}\n`);
        if (request.reason) {
            process.stdout.write(`${request.reason}\n`);
        }
        if (request.preview) {
            process.stdout.write(`${request.preview}\n`);
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
