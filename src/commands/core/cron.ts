// P19b — `xqoder cron` CLI group.
//
// Mirrors the shape of `xqoder task` so that the same TUI patterns and
// --json flag conventions apply. Runs the cron *store* only — the
// scheduler is opt-in via the CRON_TASKS feature flag and started from
// the REPL bootstrap, not from this CLI.

import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import {
    getCronService,
    isValidCronExpression,
    type CronJob,
    type CronService,
    type CronTaskTemplate,
} from '@xqoder/core-cron';
import { isTaskType, type TaskType } from '@xqoder/core-tasks';

export interface CronCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
    service?: CronService;
}

interface JsonOption {
    json?: boolean;
}

interface CreateOptions extends JsonOption {
    at?: string;
    type?: string;
    command?: string;
    cwd?: string;
    disabled?: boolean;
}

interface ListOptions extends JsonOption {
    enabled?: boolean;
    disabled?: boolean;
    limit?: string;
}

export function createCronCommand(deps: CronCommandDependencies = {}): Command {
    const command = new Command('cron').description(
        'Manage cron-triggered tasks. Each cron entry materialises a task on every fire.',
    );

    command
        .command('create')
        .description('Create a cron-triggered task.')
        .argument('<title>', 'task title')
        .requiredOption('--at <expression>', '5-field cron expression (e.g. "0 9 * * *")')
        .option('--type <type>', 'task type (shell by default)', 'shell')
        .option('--command <command>', 'shell command (required when --type shell)')
        .option('--cwd <dir>', 'working directory for the task (defaults to current cwd)')
        .option('--disabled', 'create in a disabled state')
        .option('--json', 'output as JSON')
        .action((title: string, options: CreateOptions) => runSafely(() => runCreate(title, options, deps)));

    command
        .command('list')
        .description('List cron jobs, newest first.')
        .option('--enabled', 'only enabled jobs')
        .option('--disabled', 'only disabled jobs')
        .option('--limit <n>', 'max rows (default 50)')
        .option('--json', 'output as JSON')
        .action((options: ListOptions) => runSafely(() => runList(options, deps)));

    command
        .command('get')
        .description('Fetch a cron job by id.')
        .argument('<id>', 'cron job id')
        .option('--json', 'output as JSON')
        .action((id: string, options: JsonOption) => runSafely(() => runGet(id, options, deps)));

    command
        .command('remove')
        .alias('delete')
        .alias('rm')
        .description('Remove a cron job by id.')
        .argument('<id>', 'cron job id')
        .option('--json', 'output as JSON')
        .action((id: string, options: JsonOption) => runSafely(() => runRemove(id, options, deps)));

    command
        .command('enable')
        .description('Enable a cron job (resumes scheduling).')
        .argument('<id>', 'cron job id')
        .option('--json', 'output as JSON')
        .action((id: string, options: JsonOption) => runSafely(() => runSetEnabled(id, true, options, deps)));

    command
        .command('disable')
        .description('Disable a cron job (pauses scheduling).')
        .argument('<id>', 'cron job id')
        .option('--json', 'output as JSON')
        .action((id: string, options: JsonOption) => runSafely(() => runSetEnabled(id, false, options, deps)));

    return command;
}

function resolveService(deps: CronCommandDependencies): CronService {
    return deps.service ?? getCronService();
}

function writer(deps: CronCommandDependencies): (line: string) => void {
    return deps.writeOutput ?? ((line: string) => console.log(line));
}

function cronJobToWire(job: CronJob): Record<string, unknown> {
    return {
        id: job.id,
        expression: job.expression,
        enabled: job.enabled,
        template: job.template,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        ...(job.lastFiredAt ? { lastFiredAt: job.lastFiredAt.toISOString() } : {}),
        ...(job.nextFireAt ? { nextFireAt: job.nextFireAt.toISOString() } : {}),
    };
}

function formatCronLine(job: CronJob): string {
    const status = job.enabled ? 'enabled ' : 'disabled';
    const next = job.nextFireAt ? job.nextFireAt.toISOString() : '—';
    const expr = job.expression.padEnd(15);
    const type = job.template.type.padEnd(12);
    const title = job.template.title.length > 40
        ? `${job.template.title.slice(0, 37)}...`
        : job.template.title;
    return `${job.id}  ${status}  ${expr}  ${type}  next=${next}  ${title}`;
}

export function runCreate(
    title: string,
    options: CreateOptions,
    deps: CronCommandDependencies,
): CronJob {
    const service = resolveService(deps);
    const write = writer(deps);

    const expression = (options.at ?? '').trim();
    if (!isValidCronExpression(expression)) {
        throw new Error(`invalid --at cron expression: ${expression}`);
    }

    const typeArg = options.type ?? 'shell';
    if (!isTaskType(typeArg)) {
        throw new Error(`invalid --type: ${typeArg}`);
    }

    if (typeArg === 'shell' && (!options.command || options.command.trim().length === 0)) {
        throw new Error('--command is required when --type shell');
    }

    const template: CronTaskTemplate = { title, type: typeArg as TaskType };
    if (options.command !== undefined) template.command = options.command;
    template.cwd = options.cwd ?? deps.cwd ?? process.cwd();

    const job = service.store.create({
        expression,
        template,
        enabled: !options.disabled,
    });

    if (options.json) {
        write(JSON.stringify(cronJobToWire(job), null, 2));
    } else {
        const tail = job.nextFireAt
            ? ` (next fire ${job.nextFireAt.toISOString()})`
            : ' (disabled)';
        write(`Scheduled ${job.id}${tail}.`);
    }
    return job;
}

export function runList(options: ListOptions, deps: CronCommandDependencies): CronJob[] {
    const service = resolveService(deps);
    const write = writer(deps);

    if (options.enabled && options.disabled) {
        throw new Error('cannot combine --enabled and --disabled');
    }
    const filter: { enabled?: boolean; limit?: number } = {};
    if (options.enabled) filter.enabled = true;
    if (options.disabled) filter.enabled = false;
    if (options.limit) {
        const parsed = Number(options.limit);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`invalid --limit: ${options.limit}`);
        }
        filter.limit = Math.trunc(parsed);
    } else {
        filter.limit = 50;
    }

    const jobs = service.store.list(filter);
    if (options.json) {
        write(JSON.stringify(jobs.map(cronJobToWire), null, 2));
        return jobs;
    }
    if (jobs.length === 0) {
        write('No cron jobs found.');
        return jobs;
    }
    for (const job of jobs) write(formatCronLine(job));
    return jobs;
}

export function runGet(id: string, options: JsonOption, deps: CronCommandDependencies): CronJob {
    const service = resolveService(deps);
    const write = writer(deps);
    const job = service.store.get(id);
    if (!job) throw new Error(`cron job not found: ${id}`);
    if (options.json) {
        write(JSON.stringify(cronJobToWire(job), null, 2));
    } else {
        write(`id: ${job.id}`);
        write(`expression: ${job.expression}`);
        write(`enabled: ${job.enabled}`);
        write(`template.title: ${job.template.title}`);
        write(`template.type: ${job.template.type}`);
        if (job.template.command) write(`template.command: ${job.template.command}`);
        if (job.template.cwd) write(`template.cwd: ${job.template.cwd}`);
        write(`createdAt: ${job.createdAt.toISOString()}`);
        if (job.lastFiredAt) write(`lastFiredAt: ${job.lastFiredAt.toISOString()}`);
        if (job.nextFireAt) write(`nextFireAt: ${job.nextFireAt.toISOString()}`);
    }
    return job;
}

export function runRemove(id: string, options: JsonOption, deps: CronCommandDependencies): CronJob {
    const service = resolveService(deps);
    const write = writer(deps);
    const job = service.store.get(id);
    if (!job) throw new Error(`cron job not found: ${id}`);
    service.store.delete(id);
    if (options.json) {
        write(JSON.stringify(cronJobToWire(job), null, 2));
    } else {
        write(`Removed ${id}.`);
    }
    return job;
}

export function runSetEnabled(
    id: string,
    enabled: boolean,
    options: JsonOption,
    deps: CronCommandDependencies,
): CronJob {
    const service = resolveService(deps);
    const write = writer(deps);
    const existing = service.store.get(id);
    if (!existing) throw new Error(`cron job not found: ${id}`);
    const updated = service.store.update(id, { enabled });
    if (options.json) {
        write(JSON.stringify(cronJobToWire(updated), null, 2));
    } else {
        write(`${enabled ? 'Enabled' : 'Disabled'} ${id}.`);
    }
    return updated;
}

function runSafely(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`Cron command failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

export const cronCommand = createCronCommand();
