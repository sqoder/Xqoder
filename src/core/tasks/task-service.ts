// P19a — Process-wide task service used by the 6 task tools and the CLI.
//
// Holds one SQLite TaskStore per db path plus a map of in-flight background
// handles (pid + done promise) so that TaskStopTool / TaskOutputTool started
// inside the same process can operate on live children. Cross-process calls
// (e.g. the `xqoder task stop` CLI from a separate shell) fall back to
// signalling the persisted pid.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getXQoderPaths } from '../../infra/shared/paths.js';
import { createTaskStore, type TaskStore } from './task-store.js';
import type { TaskHandle } from './task-runner.js';

export interface TaskService {
    store: TaskStore;
    dbPath: string;
    logDir: string;
    registerHandle(taskId: string, handle: TaskHandle): void;
    getHandle(taskId: string): TaskHandle | undefined;
    close(): void;
}

const SERVICE_CACHE = new Map<string, TaskService>();

export interface ResolveTaskServiceOptions {
    homeDir?: string;
    dbPath?: string;
    logDir?: string;
}

export function resolveTaskServicePaths(options: ResolveTaskServiceOptions = {}): {
    dbPath: string;
    logDir: string;
} {
    if (options.dbPath && options.logDir) {
        return { dbPath: options.dbPath, logDir: options.logDir };
    }
    const paths = getXQoderPaths(options.homeDir);
    const dataDir = paths.dataDir;
    return {
        dbPath: options.dbPath ?? path.join(dataDir, 'tasks.sqlite'),
        logDir: options.logDir ?? path.join(dataDir, 'task-logs'),
    };
}

export function getTaskService(options: ResolveTaskServiceOptions = {}): TaskService {
    const { dbPath, logDir } = resolveTaskServicePaths(options);
    const cached = SERVICE_CACHE.get(dbPath);
    if (cached) return cached;

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const store = createTaskStore(dbPath);
    const handles = new Map<string, TaskHandle>();
    const service: TaskService = {
        store,
        dbPath,
        logDir,
        registerHandle(taskId, handle) {
            handles.set(taskId, handle);
            handle.done.finally(() => {
                if (handles.get(taskId) === handle) {
                    handles.delete(taskId);
                }
            });
        },
        getHandle(taskId) {
            return handles.get(taskId);
        },
        close() {
            store.close();
            handles.clear();
            SERVICE_CACHE.delete(dbPath);
        },
    };
    SERVICE_CACHE.set(dbPath, service);
    return service;
}

// Test-only: drop all cached services so tests can use fresh DBs.
export function __resetTaskServiceCacheForTests(): void {
    for (const service of SERVICE_CACHE.values()) {
        try {
            service.store.close();
        } catch {
            // ignore
        }
    }
    SERVICE_CACHE.clear();
}
