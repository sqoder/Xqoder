export const TERMINAL_LOCAL_COMMANDS = {
    exit: ['/quit', '/exit'],
    new: ['/new', '/session new'],
} as const;

export type TerminalLocalCommand = keyof typeof TERMINAL_LOCAL_COMMANDS;

const TERMINAL_LOCAL_COMMAND_LOOKUP = new Map<string, TerminalLocalCommand>(
    Object.entries(TERMINAL_LOCAL_COMMANDS).flatMap(([command, aliases]) =>
        aliases.map((alias) => [alias, command as TerminalLocalCommand]),
    ),
);

export function resolveTerminalLocalCommand(prompt: string): TerminalLocalCommand | null {
    const trimmed = prompt.trim();
    return TERMINAL_LOCAL_COMMAND_LOOKUP.get(trimmed) ?? null;
}
