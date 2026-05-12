// P19b — Cron service: process-wide singleton that owns the CronStore,
// CronLock, and active CronScheduler. Mirrors the shape of task-service.ts
// so the 3 cron tools + the CLI all go through a single resolver.
//
// Layout:
//   - DB file: `~/.xqoder/data/cron.sqlite` (separate from tasks.sqlite)
//   - The scheduler is NOT auto-started; callers (e.g. the REPL bootstrap
//     gated behind feature CRON_TASKS) must call `service.scheduler.start()`.

import * as path from 'node:path';
import { getXQoderPaths } from '../../infra/shared/paths.js';
import {
    getTaskService,
    type TaskService,
    startTask,
} from '../tasks/index.js';
import type { CreateTaskInput, Task } from '../tasks/index.js';
import { createCronLock, type CronLock } from './cron-lock.js';
import {
    createCronScheduler,
    type CronScheduler,
} from './cron-scheduler.js';
import {
    createCronStore,
    type CronJob,
    type CronStore,
} from './cron-store.js';

export interface CronService {
    store: CronStore;
    lock: CronLock;
    scheduler: CronScheduler;
    dbPath: string;
    close(): void;
}

export interface ResolveCronServiceOptions {
    homeDir?: string;
    dbPath?: string;
    /** Override the task service used when dispatching (tests / isolation). */
    taskService?: TaskService;
    /** Default cwd used when a cron job's template omits `cwd`. */
    defaultCwd?: string;
}

const SERVICE_CACHE = new Map<string, CronService>();

export function resolveCronDbPath(options: ResolveCronServiceOptions = {}): string {
    if (options.dbPath) return options.dbPath;
    const paths = getXQoderPaths(options.homeDir);
    return path.join(paths.dataDir, 'cron.sqlite');
}

export function getCronService(options: ResolveCronServiceOptions = {}): CronService {
    const dbPath = resolveCronDbPath(options);
    const cached = SERVICE_CACHE.get(dbPath);
    if (cached) return cached;

    const store = createCronStore(dbPath);
    const lock = createCronLock(dbPath);
    const taskService = options.taskService ?? getTaskService({ homeDir: options.homeDir });
    const defaultCwd = options.defaultCwd ?? process.cwd();

    const scheduler = createCronScheduler({
        store,
        lock,
        dispatch: (job: CronJob, firedAt: Date) => {
            dispatchCronJob(job, firedAt, taskService, defaultCwd);
        },
    });

    const service: CronService = {
        store,
        lock,
        scheduler,
        dbPath,
        close() {
            scheduler.stop();
            try { lock.close(); } catch { /* ignore */ }
            try { store.close(); } catch { /* ignore */ }
            SERVICE_CACHE.delete(dbPath);
        },
    };
    SERVICE_CACHE.set(dbPath, service);
    return service;
}

function dispatchCronJob(
    job: CronJob,
    firedAt: Date,
    taskService: TaskService,
    defaultCwd: string,
): Task {
    const metadata: Record<string, unknown> = {
        ...(job.template.metadata ?? {}),
        cronJobId: job.id,
        cronFiredAt: firedAt.toISOString(),
        cronExpression: job.expression,
    };
    const input: CreateTaskInput = {
        title: job.template.title,
        type: job.template.type,
        metadata,
    };
    if (job.template.command) input.command = job.template.command;

    const task = taskService.store.create(input);
    if (job.template.type !== 'shell') {
        // P19a only runs shell tasks; non-shell types stay as pending rows
        // until later sub-phases plug in their runners. We still record the
        // task so the cron audit trail is complete.
        return task;
    }
    const handle = startTask(task, {
        store: taskService.store,
        cwd: job.template.cwd ?? defaultCwd,
        logDir: taskService.logDir,
    });
    taskService.registerHandle(task.id, handle);
    return task;
}

// Test-only: drop cached services so each test runs against a fresh DB.
export function __resetCronServiceCacheForTests(): void {
    for (const service of SERVICE_CACHE.values()) {
        try { service.close(); } catch { /* ignore */ }
    }
    SERVICE_CACHE.clear();
}
