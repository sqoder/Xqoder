import { describe, expect, it } from 'vitest';
import { ProjectType, WorkflowStatus } from '@xqoder/shared';
import { WorkflowEngine } from '../engine.js';
import { createBuildProjectSteps } from './build-project.js';

describe('build workflow template', () => {
    it('delegates each build step to the supplied handlers', async () => {
        const calls: string[] = [];
        const steps = createBuildProjectSteps({
            analyzeRequirements: async () => {
                calls.push('analyze');
                return 'requirements ready';
            },
            generateStructure: async () => {
                calls.push('structure');
                return 'structure ready';
            },
            generateCode: async () => {
                calls.push('code');
                return 'code ready';
            },
            installDependencies: async () => {
                calls.push('install');
                return 'dependencies ready';
            },
            runProject: async () => {
                calls.push('run');
                return 'runtime ready';
            },
            runTests: async () => {
                calls.push('test');
                return 'tests ready';
            },
        });

        const engine = new WorkflowEngine().addSteps(steps);
        const result = await engine.execute('build a blog', {
            rootDir: '/tmp/blog',
            type: ProjectType.Node,
            name: 'blog',
        });

        expect(result.status).toBe(WorkflowStatus.Completed);
        expect(calls).toEqual([
            'analyze',
            'structure',
            'code',
            'install',
            'run',
            'test',
        ]);
    });
});
