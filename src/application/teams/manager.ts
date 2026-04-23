import { SharedTaskList, type TeamTask } from './task-list.js';
import { runNonInteractivePrompt } from '../chat/run-chat.js';
import { type ChatServiceDependencies } from '../chat/run-chat.js';

export interface TeamMember {
    role: 'planner' | 'explorer' | 'executor' | 'reviewer' | 'verifier';
    agentName: string;
}

export interface TeamConfig {
    members: TeamMember[];
    parallelLimit: number;
}

export class TeamManager {
    private taskList: SharedTaskList = new SharedTaskList();
    private config: TeamConfig;
    private dependencies: ChatServiceDependencies;

    constructor(config: TeamConfig, dependencies: ChatServiceDependencies = {}) {
        this.config = config;
        this.dependencies = dependencies;
    }

    async runTeamWorkflow(goal: string, cwd: string): Promise<void> {
        console.log(`Starting team workflow for goal: ${goal}`);
        
        // 1. Planning phase
        const planner = this.config.members.find(m => m.role === 'planner') || { role: 'planner', agentName: 'plan' };
        console.log(`Phase 1: Planning with agent ${planner.agentName}`);
        
        // In a real implementation, we would use the planner agent to decompose the goal into tasks.
        // For this replica, we'll simulate the decomposition or provide a default task.
        
        this.taskList.addTask({
            id: 'task-1',
            title: 'Initial Research',
            description: `Explore the codebase for: ${goal}`,
            status: 'pending',
            dependencies: [],
            artifacts: [],
        });

        this.taskList.addTask({
            id: 'task-2',
            title: 'Implementation',
            description: `Implement the changes for: ${goal}`,
            status: 'pending',
            dependencies: ['task-1'],
            artifacts: [],
        });

        // 2. Execution phase (simplified parallel loop)
        while (this.hasUnfinishedTasks()) {
            const availableTasks = this.taskList.getPendingTasks().filter(t => !this.taskList.isBlocked(t.id));
            
            if (availableTasks.length === 0 && this.hasInProgressTasks()) {
                // Wait for some tasks to complete (in a real async loop)
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            if (availableTasks.length === 0) break;

            // Run tasks in parallel up to the limit
            const tasksToRun = availableTasks.slice(0, this.config.parallelLimit);
            await Promise.all(tasksToRun.map(task => this.executeTask(task, cwd)));
        }

        console.log('Team workflow completed.');
    }

    private hasUnfinishedTasks(): boolean {
        return this.taskList.getAllTasks().some(t => t.status !== 'completed' && t.status !== 'failed');
    }

    private hasInProgressTasks(): boolean {
        return this.taskList.getAllTasks().some(t => t.status === 'in-progress');
    }

    private async executeTask(task: TeamTask, cwd: string): Promise<void> {
        this.taskList.updateTask(task.id, { status: 'in-progress' });
        console.log(`Executing task ${task.id}: ${task.title}`);

        try {
            const member = this.getMemberForTask(task);
            await runNonInteractivePrompt({
                prompt: `Task: ${task.title}\nDescription: ${task.description}`,
                cwd,
                outputFormat: 'text',
                quiet: true,
                agent: member.agentName,
            }, this.dependencies);

            this.taskList.updateTask(task.id, { status: 'completed' });
            console.log(`Task ${task.id} completed.`);
        } catch (error) {
            this.taskList.updateTask(task.id, { status: 'failed' });
            console.error(`Task ${task.id} failed: ${error}`);
        }
    }

    private getMemberForTask(task: TeamTask): TeamMember {
        if (task.title.toLowerCase().includes('research') || task.title.toLowerCase().includes('explore')) {
            return this.config.members.find(m => m.role === 'explorer') || { role: 'explorer', agentName: 'explorer' };
        }
        if (task.title.toLowerCase().includes('review')) {
            return this.config.members.find(m => m.role === 'reviewer') || { role: 'reviewer', agentName: 'reviewer' };
        }
        return this.config.members.find(m => m.role === 'executor') || { role: 'executor', agentName: 'coder' };
    }
}
