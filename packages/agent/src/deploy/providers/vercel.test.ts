import type { ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployStatus, DeployTarget } from '@xqoder/shared';
import { VercelDeployer } from './vercel.js';

const tempDirs: string[] = [];

function createTempProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-vercel-'));
    tempDirs.push(dir);
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

describe('VercelDeployer', () => {
    it('deploys from projectDir, writes vercel.json, and verifies the URL', async () => {
        const tempRoot = createTempProject();
        const projectDir = path.join(tempRoot, 'sample-project');
        fs.mkdirSync(projectDir);
        const exec = vi.fn((_: string, __: ExecSyncOptionsWithStringEncoding) => 'Production: https://sample-project.vercel.app');
        const fetch = vi.fn(async () => ({ status: 200 }));
        const deployer = new VercelDeployer({
            token: 'vercel-token',
            execSync: exec,
            fetch,
        });

        const result = await deployer.deploy({
            target: DeployTarget.Vercel,
            projectDir,
            projectName: 'sample-project',
            scope: 'my-team',
            buildCommand: 'npm run build',
            outputDir: 'dist',
        });

        expect(exec).toHaveBeenCalledWith(
            expect.stringContaining('vercel --yes'),
            expect.objectContaining({
                cwd: projectDir,
            }),
        );
        expect(exec).toHaveBeenCalledWith(
            expect.stringContaining('--scope my-team'),
            expect.any(Object),
        );
        expect(exec).toHaveBeenCalledWith(
            expect.stringContaining('2>&1'),
            expect.any(Object),
        );
        expect(fetch).toHaveBeenCalledWith(
            'https://sample-project.vercel.app',
            expect.objectContaining({
                method: 'HEAD',
            }),
        );
        expect(result).toMatchObject({
            status: DeployStatus.Ready,
            projectDir,
            target: DeployTarget.Vercel,
            url: 'https://sample-project.vercel.app',
        });

        const vercelConfig = JSON.parse(fs.readFileSync(path.join(projectDir, 'vercel.json'), 'utf-8')) as Record<string, unknown>;
        expect(vercelConfig).toMatchObject({
            version: 2,
            buildCommand: 'npm run build',
            outputDirectory: 'dist',
        });
    });

    it('reads READY status from vercel inspect output', async () => {
        const exec = vi.fn(() => 'status\tREADY');
        const deployer = new VercelDeployer({
            scope: 'my-team',
            execSync: exec,
        });

        await expect(deployer.getStatus('deployment-id')).resolves.toBe(DeployStatus.Ready);
        expect(exec).toHaveBeenCalledWith(
            expect.stringContaining('--scope my-team'),
            expect.any(Object),
        );
    });

    it('falls back to GET when HEAD verification returns 401', async () => {
        const projectDir = createTempProject();
        const exec = vi.fn((_: string, __: ExecSyncOptionsWithStringEncoding) => 'Production: https://sample-project.vercel.app');
        const fetch = vi.fn()
            .mockResolvedValueOnce({ status: 401 })
            .mockResolvedValueOnce({ status: 200 });
        const deployer = new VercelDeployer({
            token: 'vercel-token',
            execSync: exec,
            fetch,
        });

        const result = await deployer.deploy({
            target: DeployTarget.Vercel,
            projectDir,
            projectName: 'sample-project',
            buildCommand: 'npm run build',
            outputDir: 'dist',
        });

        expect(fetch).toHaveBeenNthCalledWith(
            1,
            'https://sample-project.vercel.app',
            expect.objectContaining({ method: 'HEAD' }),
        );
        expect(fetch).toHaveBeenNthCalledWith(
            2,
            'https://sample-project.vercel.app',
            expect.objectContaining({ method: 'GET' }),
        );
        expect(result.status).toBe(DeployStatus.Ready);
    });

    it('prefers the aliased production URL when Vercel outputs both URLs', async () => {
        const projectDir = createTempProject();
        const exec = vi.fn((_: string, __: ExecSyncOptionsWithStringEncoding) => [
            'Inspect: https://vercel.com/example/project/deploy-id',
            '\u001b[2K\u001b[1A\u001b[2K\u001b[GProduction: https://sample-project-random.vercel.app [11s]',
            'Completing...',
            'Aliased: https://sample-project.vercel.app [11s]',
        ].join('\n'));
        const fetch = vi.fn(async () => ({ status: 200 }));
        const deployer = new VercelDeployer({
            token: 'vercel-token',
            execSync: exec,
            fetch,
        });

        const result = await deployer.deploy({
            target: DeployTarget.Vercel,
            projectDir,
            projectName: 'sample-project',
            buildCommand: 'npm run build',
            outputDir: 'dist',
        });

        expect(fetch).toHaveBeenCalledWith(
            'https://sample-project.vercel.app',
            expect.any(Object),
        );
        expect(result.url).toBe('https://sample-project.vercel.app');
    });

    it('deploys through a sanitized alias directory when the local folder name is unsafe', async () => {
        const tempRoot = createTempProject();
        const unsafeProjectDir = path.join(tempRoot, 'Unsafe Project Dir');
        fs.mkdirSync(unsafeProjectDir);

        const exec = vi.fn((_: string, __: ExecSyncOptionsWithStringEncoding) => 'Production: https://syntax-error-fixture.vercel.app');
        const fetch = vi.fn(async () => ({ status: 200 }));
        const deployer = new VercelDeployer({
            token: 'vercel-token',
            execSync: exec,
            fetch,
        });

        const result = await deployer.deploy({
            target: DeployTarget.Vercel,
            projectDir: unsafeProjectDir,
            projectName: 'syntax-error-fixture',
            buildCommand: 'npm run build',
            outputDir: 'dist',
        });

        const firstCall = exec.mock.calls[0];
        expect(firstCall).toBeDefined();

        const deployOptions = firstCall?.[1] as ExecSyncOptionsWithStringEncoding | undefined;
        const deployCwd = deployOptions?.cwd;

        expect(deployCwd).toBeDefined();
        expect(deployCwd).not.toBe(unsafeProjectDir);
        if (!deployCwd) {
            throw new Error('expected a deploy cwd');
        }
        const deployDirName = path.basename(typeof deployCwd === 'string' ? deployCwd : deployCwd.pathname);
        expect(deployDirName).toBe('syntax-error-fixture');
        expect(result).toMatchObject({
            status: DeployStatus.Ready,
            projectDir: unsafeProjectDir,
            url: 'https://syntax-error-fixture.vercel.app',
        });
    });
});
