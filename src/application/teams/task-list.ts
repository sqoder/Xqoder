export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'blocked';

export interface TeamTask {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    owner?: string;
    dependencies: string[];
    artifacts: string[];
    createdAt: string;
    updatedAt: string;
}

export class SharedTaskList {
    private tasks: Map<string, TeamTask> = new Map();

    addTask(task: Omit<TeamTask, 'createdAt' | 'updatedAt'>): TeamTask {
        const now = new Date().toISOString();
        const newTask: TeamTask = {
            ...task,
            createdAt: now,
            updatedAt: now,
        };
        this.tasks.set(newTask.id, newTask);
        return newTask;
    }

    getTask(id: string): TeamTask | undefined {
        return this.tasks.get(id);
    }

    updateTask(id: string, updates: Partial<TeamTask>): TeamTask | undefined {
        const task = this.tasks.get(id);
        if (!task) return undefined;

        const updatedTask = {
            ...task,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        this.tasks.set(id, updatedTask);
        return updatedTask;
    }

    getAllTasks(): TeamTask[] {
        return Array.from(this.tasks.values());
    }

    getPendingTasks(): TeamTask[] {
        return this.getAllTasks().filter(t => t.status === 'pending');
    }

    isBlocked(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task) return false;

        return task.dependencies.some(depId => {
            const depTask = this.tasks.get(depId);
            return !depTask || depTask.status !== 'completed';
        });
    }
}
