import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeployTarget } from '@xqoder/shared';
import { DeployConfigGenerator } from './config-generator.js';
import { sanitizeProjectName } from './project-name.js';

const tempDirs: string[] = [];

function createTempProject(packageJson: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-deploy-config-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('DeployConfigGenerator', () => {
    it('generates Vercel-friendly config for a Vite project', () => {
        const projectDir = createTempProject({
            name: 'vite-blog',
            scripts: {
                build: 'vite build',
            },
            devDependencies: {
                vite: '^6.0.0',
            },
        });

        const generator = new DeployConfigGenerator();
        const config = generator.generate(projectDir);

        expect(config).toMatchObject({
            target: DeployTarget.Vercel,
            projectDir,
            projectName: 'vite-blog',
            buildCommand: 'npm run build',
            outputDir: 'dist',
        });
    });

    it('falls back to the directory name when package name is missing', () => {
        const projectDir = createTempProject({
            scripts: {
                build: 'next build',
            },
            dependencies: {
                next: '^15.0.0',
            },
        });

        const generator = new DeployConfigGenerator();
        const config = generator.generate(projectDir);

        expect(config.projectName).toBe(sanitizeProjectName(path.basename(projectDir)));
        expect(config.target).toBe(DeployTarget.Vercel);
        expect(config.outputDir).toBe('.next');
    });
});
