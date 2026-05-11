// P19a — SQLite-backed task store.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    createTaskStore,
    type TaskStore,
} from '../../../src/core/tasks/task-store.js';

function tmpDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-tasks-'));
    return path.join(dir, 'tasks.sqlite');
}

describe('createTaskStore', () => {
    let store: TaskStore;

    beforeEach(() => {
        store = createTaskStore(tmpDbPath());
    });

    afterEach(() => {
        store.close();
    });

    it('creates a task with defaulted fields', () => {
        const task = store.create({
            title: 'echo hi',
            type: 'shell',
            command: 'echo hi',
        });
        expect(task.id).toMatch(/^task_/);
        expect(task.status).toBe('pending');
        expect(task.title).toBe('echo hi');
        expect(task.type).toBe('shell');
        expect(task.command).toBe('echo hi');
        expect(task.createdAt instanceof Date).toBe(true);
        expect(task.updatedAt instanceof Date).toBe(true);
    });

    it('round-trips metadata as JSON', () => {
        const created = store.create({
            title: 't',
            type: 'shell',
            command: 'ls',
            metadata: { foo: 'bar', n: 1 },
        });
        const fetched = store.get(created.id);
        expect(fetched?.metadata).toEqual({ foo: 'bar', n: 1 });
    });

    it('get returns null for unknown id', () => {
        expect(store.get('task_nope')).toBeNull();
    });

    it('lists tasks newest-first and filters by status/type', () => {
        const a = store.create({ title: 'a', type: 'shell', command: 'a' });
        const b = store.create({ title: 'b', type: 'shell', command: 'b' });
        store.update(a.id, { status: 'running' });

        const all = store.list();
        expect(all.map((t) => t.id)).toEqual([b.id, a.id]);

        const running = store.list({ status: 'running' });
        expect(running.map((t) => t.id)).toEqual([a.id]);

        const shells = store.list({ type: 'shell' });
        expect(shells.length).toBe(2);

        const limited = store.list({ limit: 1 });
        expect(limited.length).toBe(1);
    });

    it('update patches status/exitCode/pid/logPath and bumps updatedAt', async () => {
        const t = store.create({ title: 't', type: 'shell', command: 'x' });
        await new Promise((r) => setTimeout(r, 5));
        const updated = store.update(t.id, {
            status: 'running',
            pid: 4242,
            logPath: '/tmp/x.log',
        });
        expect(updated.status).toBe('running');
        expect(updated.pid).toBe(4242);
        expect(updated.logPath).toBe('/tmp/x.log');
        expect(updated.updatedAt.getTime()).toBeGreaterThan(t.updatedAt.getTime());

        const finished = store.update(t.id, { status: 'completed', exitCode: 0 });
        expect(finished.status).toBe('completed');
        expect(finished.exitCode).toBe(0);
        expect(finished.finishedAt instanceof Date).toBe(true);
    });

    it('update on unknown id throws', () => {
        expect(() => store.update('task_nope', { status: 'completed' })).toThrow();
    });

    it('delete removes the task', () => {
        const t = store.create({ title: 't', type: 'shell', command: 'x' });
        store.delete(t.id);
        expect(store.get(t.id)).toBeNull();
    });

    it('supports all task types', () => {
        const types = ['main', 'agent', 'shell', 'monitor-mcp', 'remote-agent', 'dream'] as const;
        for (const type of types) {
            const t = store.create({ title: type, type });
            expect(store.get(t.id)?.type).toBe(type);
        }
    });

    it('rejects unknown task type', () => {
        // @ts-expect-error intentional bad input
        expect(() => store.create({ title: 'x', type: 'nope' })).toThrow();
    });

    it('rejects unknown status patch', () => {
        const t = store.create({ title: 't', type: 'shell' });
        // @ts-expect-error intentional bad status
        expect(() => store.update(t.id, { status: 'bogus' })).toThrow();
    });
});
