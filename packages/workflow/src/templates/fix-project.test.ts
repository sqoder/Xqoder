import { describe, expect, it } from 'vitest';
import { ProjectType, WorkflowStatus } from '@xqoder/shared';
import { WorkflowEngine } from '../engine.js';
import { createFixProjectSteps } from './fix-project.js';

describe('fix workflow template', () => {
    it('marks the workflow as failed when a handler throws', async () => {
        const steps = createFixProjectSteps({
            runAndDetectErrors: async () => 'errors captured',
            analyzeErrors: async () => 'errors analyzed',
            generateFix: async () => {
                throw new Error('fix generation failed');
            },
            applyFix: async () => 'fix applied',
            verifyFix: async () => 'fix verified',
        });

        const engine = new WorkflowEngine().addSteps(steps);
        const result = await engine.execute('fix my app', {
            rootDir: '/tmp/app',
            type: ProjectType.Node,
            name: 'app',
        });

        expect(result.status).toBe(WorkflowStatus.Failed);
        expect(result.error).toBe('fix generation failed');
    });
});
