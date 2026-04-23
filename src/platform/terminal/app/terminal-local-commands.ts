export const TERMINAL_LOCAL_COMMANDS = {
    exit: ['/quit', '/exit', '/bye'],
    new: ['/new', '/reset', '/session new'],
    help: ['/help', '/?'],
    clear: ['/clear', '/cls'],
    compact: ['/compact', '/compress'],
    memory: ['/memory', '/mem'],
    status: ['/status', '/stats'],
    model: ['/model', '/llm'],
    permissions: ['/permissions', '/auth'],
    review: ['/review'],
    plan: ['/plan'],
} as const;

export type TerminalLocalCommand = keyof typeof TERMINAL_LOCAL_COMMANDS;

const TERMINAL_LOCAL_COMMAND_LOOKUP = new Map<string, TerminalLocalCommand>(
    Object.entries(TERMINAL_LOCAL_COMMANDS).flatMap(([command, aliases]) =>
        aliases.map((alias) => [alias, command as TerminalLocalCommand]),
    ),
);

export function resolveTerminalLocalCommand(prompt: string): TerminalLocalCommand | null {
    const trimmed = prompt.trim();
    if (!trimmed) {
        return null;
    }

    for (const [alias, command] of TERMINAL_LOCAL_COMMAND_LOOKUP.entries()) {
        if (trimmed === alias || trimmed.startsWith(`${alias} `)) {
            return command;
        }
    }

    return null;
}
