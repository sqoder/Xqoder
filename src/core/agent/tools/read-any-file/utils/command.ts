import { execa } from 'execa';

export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export async function commandExists(
    command: string,
    env?: Record<string, string>,
): Promise<boolean> {
    const result = await execa('/bin/sh', ['-c', `command -v ${quoteShellWord(command)}`], {
        env: mergeEnv(env),
        reject: false,
        timeout: 2_000,
    });
    return result.exitCode === 0;
}

export async function runCommand(
    command: string,
    args: string[],
    input: {
        env?: Record<string, string>;
        timeoutMs: number;
    },
): Promise<CommandResult> {
    const result = await execa(command, args, {
        env: mergeEnv(input.env),
        reject: false,
        timeout: input.timeoutMs,
    });
    return {
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

function mergeEnv(env: Record<string, string> | undefined): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ...(env ?? {}),
    };
}

function quoteShellWord(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
