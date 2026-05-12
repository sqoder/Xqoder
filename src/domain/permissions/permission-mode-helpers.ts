import type { AgentPermissionMode } from '@xqoder/foundation-shared/types/permissions.js';
import { classifyByRule } from './classifier/index.js';

/**
 * P04 permission-mode helpers. Extracted from tool-policy.ts to keep that
 * file under the 1000-line hotspot guardrail.
 */

export function resolveAcceptEditsMode(isWriteLike: boolean, isReadLike: boolean): AgentPermissionMode {
    return isWriteLike || isReadLike ? 'allow' : 'ask';
}

export function resolveAutoShellMode(command: string): AgentPermissionMode {
    const verdict = classifyByRule(command);
    if (verdict?.decision === 'deny') return 'deny';
    if (verdict?.decision === 'allow') return 'allow';
    return 'ask';
}

export function resolveAutoShellEarlyDeny(toolName: string, args: Record<string, unknown> | undefined): AgentPermissionMode | null {
    if (toolName !== 'run_command' && toolName !== 'run_shell') return null;
    const command = typeof args?.['command'] === 'string' ? args['command'] as string : '';
    return classifyByRule(command)?.decision === 'deny' ? 'deny' : null;
}
