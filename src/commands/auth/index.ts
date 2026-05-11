// P21c — `xqoder auth` command group.

import { Command } from 'commander';
import { createAuthLoginCommand, type AuthLoginDependencies } from './login.js';
import { createAuthLogoutCommand, createAuthStatusCommand, type AuthLogoutDependencies } from './logout.js';

export interface AuthCommandDependencies extends AuthLoginDependencies, AuthLogoutDependencies {}

export function createAuthCommand(dependencies: AuthCommandDependencies = {}): Command {
    const cmd = new Command('auth').description('OAuth login/logout/status for LLM providers.');
    cmd.addCommand(createAuthLoginCommand(dependencies));
    cmd.addCommand(createAuthLogoutCommand(dependencies));
    cmd.addCommand(createAuthStatusCommand(dependencies));
    return cmd;
}

export const authCommand = createAuthCommand();
