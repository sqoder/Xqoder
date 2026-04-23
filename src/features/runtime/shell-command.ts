import * as path from 'node:path';

export interface ShellCommandConfig {
    path?: string;
    args?: string[];
}

export interface ShellCommandInvocation {
    executable: string;
    args: string[];
}

export function buildShellCommandInvocation(
    command: string,
    shell: ShellCommandConfig = {},
): ShellCommandInvocation {
    const shellPath = shell.path?.trim()
        || process.env['SHELL']?.trim()
        || defaultShellPath();
    const shellName = path.basename(shellPath).toLowerCase();

    if (shellName === 'cmd' || shellName === 'cmd.exe') {
        return {
            executable: shellPath,
            args: ['/d', '/s', '/c', command],
        };
    }

    if (
        shellName === 'powershell'
        || shellName === 'powershell.exe'
        || shellName === 'pwsh'
        || shellName === 'pwsh.exe'
    ) {
        return {
            executable: shellPath,
            args: ['-NoProfile', '-Command', command],
        };
    }

    if (shellName === 'sh') {
        return {
            executable: shellPath,
            args: ['-c', command],
        };
    }

    return {
        executable: shellPath,
        args: ['-lc', command],
    };
}

function defaultShellPath(): string {
    if (process.platform === 'win32') {
        return process.env['ComSpec']?.trim() || 'cmd.exe';
    }

    return '/bin/sh';
}
