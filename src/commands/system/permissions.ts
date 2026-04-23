import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    createPermissionsSnapshot,
    runPermissionsCommand,
    runPermissionsPathCommand,
    runSetApprovalPolicyCommand,
    runSetPermissionsDefaultCommand,
    runSetToolPermissionCommand,
    runShowPermissionsCommand,
    runUnsetToolPermissionCommand,
    type PermissionRuleView,
    type PermissionsCommandDependencies,
    type PermissionsOutputOptions,
    type PermissionsSnapshot,
    type PermissionWriteResult,
} from '../../application/system/permissions.js';

export {
    createPermissionsSnapshot,
    runPermissionsPathCommand,
    runSetApprovalPolicyCommand,
    runSetPermissionsDefaultCommand,
    runSetToolPermissionCommand,
    runShowPermissionsCommand,
    runUnsetToolPermissionCommand,
};
export type {
    PermissionRuleView,
    PermissionsCommandDependencies,
    PermissionsOutputOptions,
    PermissionsSnapshot,
    PermissionWriteResult,
};

export function createPermissionsCommand(
    manager: ConfigManager = configManager,
    dependencies: PermissionsCommandDependencies = {},
): Command {
    const command = new Command('permissions')
        .description('Inspect and update tool permission rules')
        .action((options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runShowPermissionsCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show effective permission rules, sandbox mode, and config sources')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runShowPermissionsCommand(options, dependencies, manager));
        });

    command
        .command('path')
        .description('Print the config file path used when writing permission settings')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runPermissionsPathCommand(options, dependencies));
        });

    command
        .command('default')
        .description('Set the default permission mode in one config scope')
        .argument('<mode>', 'allow | ask | deny')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((mode: string, options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runSetPermissionsDefaultCommand(mode, options, dependencies));
        });

    command
        .command('policy')
        .description('Set the approval policy in one config scope')
        .argument('<policy>', 'strict | balanced | workspace_auto')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((policy: string, options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runSetApprovalPolicyCommand(policy, options, dependencies));
        });

    command
        .command('set')
        .description('Set a permission mode for a specific tool key in one config scope')
        .argument('<tool>', 'tool key, for example bash or edit')
        .argument('<mode>', 'allow | ask | deny')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((tool: string, mode: string, options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runSetToolPermissionCommand(tool, mode, options, dependencies));
        });

    command
        .command('unset')
        .description('Remove a per-tool permission override from one config scope')
        .argument('<tool>', 'tool key, for example bash or edit')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((tool: string, options: PermissionsOutputOptions) => {
            runPermissionsCommand(() => runUnsetToolPermissionCommand(tool, options, dependencies));
        });

    return command;
}

export const permissionsCommand = createPermissionsCommand();
