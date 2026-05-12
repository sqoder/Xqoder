// P16a — Built-in subagent registry.
//
// Five built-in subagents mirror the OpenClaude set:
//   - explore: read-only investigation (parallelizable)
//   - plan:    read-only planning (parallelizable)
//   - general-purpose: full toolbelt (not parallelizable)
//   - verification:   focused verification run (read + run_shell)
//   - claude-code-guide: documentation lookup (read-only)
//
// Each entry carries a system prompt + allowed-tool glob list + a
// concurrencySafe flag used by the AgentTool scheduler (P16c) to decide
// whether it can fan out multiple invocations in parallel.
//
// System-prompt text is authored here. We intentionally keep it short and
// scoped to the agent's role so we do not inflate context for sub-agents
// that will already inherit the parent's project memory.

export interface BuiltInAgent {
    readonly name: string;
    readonly description: string;
    readonly systemPrompt: string;
    /** Tool name globs. `['*']` means all tools from the parent pool. */
    readonly allowedTools: readonly string[];
    readonly concurrencySafe: boolean;
    /** Display color for TUI + logs; ignored elsewhere. */
    readonly color: string;
}

const EXPLORE_PROMPT = `You are an explore subagent. Your job is to investigate the codebase and \
return a concise report of what you found. Rules:
- Only use read-only tools (read_file, grep_content, glob_files, list_files, lsp_*).
- Do not modify files. Do not run shell commands.
- Answer the caller's question directly; keep the response short but concrete.
- When citing code, quote the file path + line range.`;

const PLAN_PROMPT = `You are a planning subagent. Produce a short, actionable plan for the \
request. Rules:
- You may read and search. You must not modify files.
- Keep plans under 10 steps unless the parent explicitly asked for more detail.
- Order steps by dependency. Flag decisions that the parent should make.`;

const GENERAL_PURPOSE_PROMPT = `You are a general-purpose subagent. You may use any tool available to \
the parent agent, including file modification and shell commands, subject to the parent's \
permission policy. Keep the scope tight: do exactly what the parent asked, report back, and \
stop. Do not open unrelated follow-up work.`;

const VERIFICATION_PROMPT = `You are a verification subagent. Your job is to run the specified \
verification command(s), summarize the outcome, and stop.
- Use read_file to understand context; use run_shell only for the verification command.
- If the command fails, report the failing output verbatim (first 40 lines) and stop.
- Do not attempt to fix failures yourself — that is the parent's decision.`;

const CODE_GUIDE_PROMPT = `You are a code-guide subagent. Answer questions about the codebase using \
read-only tools.
- Prefer lsp_* lookups when asked about types, symbols, or references.
- When the user asks "where is X implemented?", return a ranked list of file paths with one-line \
summaries.
- Never edit files.`;

export const BUILT_IN_AGENTS: Readonly<Record<string, BuiltInAgent>> = Object.freeze({
    'explore': {
        name: 'explore',
        description: 'Read-only codebase investigation subagent',
        systemPrompt: EXPLORE_PROMPT,
        allowedTools: ['read_file', 'grep_content', 'glob_files', 'list_files', 'lsp_*'],
        concurrencySafe: true,
        color: 'cyan',
    },
    'plan': {
        name: 'plan',
        description: 'Read-only planning subagent',
        systemPrompt: PLAN_PROMPT,
        allowedTools: ['read_file', 'grep_content', 'glob_files', 'list_files'],
        concurrencySafe: true,
        color: 'magenta',
    },
    'general-purpose': {
        name: 'general-purpose',
        description: 'General-purpose subagent with full toolbelt',
        systemPrompt: GENERAL_PURPOSE_PROMPT,
        allowedTools: ['*'],
        concurrencySafe: false,
        color: 'yellow',
    },
    'verification': {
        name: 'verification',
        description: 'Focused verification subagent (read + shell)',
        systemPrompt: VERIFICATION_PROMPT,
        allowedTools: ['read_file', 'run_shell'],
        concurrencySafe: false,
        color: 'green',
    },
    'claude-code-guide': {
        name: 'claude-code-guide',
        description: 'Read-only code-guide subagent (LSP-aware)',
        systemPrompt: CODE_GUIDE_PROMPT,
        allowedTools: ['read_file', 'grep_content', 'lsp_*'],
        concurrencySafe: true,
        color: 'blue',
    },
});

export function listBuiltInAgents(): readonly BuiltInAgent[] {
    return Object.values(BUILT_IN_AGENTS);
}

export function getBuiltInAgent(name: string): BuiltInAgent | undefined {
    return BUILT_IN_AGENTS[name];
}

/**
 * Returns the subset of `pool` whose names match at least one of the agent's
 * `allowedTools` patterns. A pattern may end in `*` to match a prefix.
 * `['*']` means every tool in the pool is allowed.
 */
export function filterToolsForAgent(
    pool: readonly string[],
    agent: Pick<BuiltInAgent, 'allowedTools'>,
): string[] {
    if (agent.allowedTools.length === 1 && agent.allowedTools[0] === '*') {
        return [...pool];
    }
    const patterns = agent.allowedTools.map(toMatcher);
    return pool.filter((tool) => patterns.some((matcher) => matcher(tool)));
}

function toMatcher(pattern: string): (name: string) => boolean {
    if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return (name) => name.startsWith(prefix);
    }
    return (name) => name === pattern;
}
