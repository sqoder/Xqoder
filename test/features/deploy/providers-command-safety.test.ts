import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DeployStatus, DeployTarget, type DeployConfig } from '../../../src/infra/shared/types.js';
import {
    AWSDeployer,
    CloudflareDeployer,
    VercelDeployer,
} from '../../../src/features/deploy/index.js';

interface ExecFileCall {
    args: string[];
    env?: NodeJS.ProcessEnv;
    file: string;
}

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function createProjectDir(): string {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-deploy-safe-'));
    fs.mkdirSync(path.join(projectDir, 'dist'), { recursive: true });
    tempDirs.push(projectDir);
    return projectDir;
}

function createConfig(target: DeployTarget, projectDir: string): DeployConfig {
    return {
        target,
        projectDir,
        outputDir: 'dist',
    };
}

describe('deployment provider command safety', () => {
    it('runs Vercel CLI with argv and keeps token out of argv', async () => {
        const calls: ExecFileCall[] = [];
        const token = 'vercel-token; rm -rf /';
        const deployer = new VercelDeployer({
            token,
            scope: 'team; rm -rf /',
            execFileSync: (file, args, options) => {
                calls.push({
                    file,
                    args: [...args],
                    env: options.env,
                });
                return args.includes('inspect')
                    ? 'READY'
                    : 'Production: https://safe.vercel.app';
            },
            fetch: async () => ({ status: 200 }),
        });

        const result = await deployer.deploy({
            ...createConfig(DeployTarget.Vercel, createProjectDir()),
            scope: 'cli-scope; rm -rf /',
        });
        const status = await deployer.getStatus('deploy-id; rm -rf /');

        expect(result.status).toBe(DeployStatus.Ready);
        expect(status).toBe(DeployStatus.Ready);
        expect(calls[0]).toMatchObject({
            file: 'npx',
            args: ['-y', 'vercel', '--yes', '--scope', 'cli-scope; rm -rf /', '--prod'],
        });
        expect(calls[1]).toMatchObject({
            file: 'npx',
            args: ['-y', 'vercel', 'inspect', 'deploy-id; rm -rf /', '--scope', 'team; rm -rf /'],
        });
        expect(calls.flatMap((call) => call.args).some((arg) => arg.includes(token))).toBe(false);
        expect(calls[0].env?.VERCEL_TOKEN).toBe(token);
        expect(calls[1].env?.VERCEL_TOKEN).toBe(token);
    });

    it('runs Cloudflare Wrangler with argv and keeps API token in env only', async () => {
        const calls: ExecFileCall[] = [];
        const apiToken = 'cloudflare-token; rm -rf /';
        const projectDir = createProjectDir();
        const deployer = new CloudflareDeployer({
            accountId: 'account; rm -rf /',
            apiToken,
            execFileSync: (file, args, options) => {
                calls.push({
                    file,
                    args: [...args],
                    env: options.env,
                });
                return 'https://safe.pages.dev';
            },
        });

        const result = await deployer.deploy({
            ...createConfig(DeployTarget.Cloudflare, projectDir),
            projectName: 'site; rm -rf /',
        });

        expect(result.status).toBe(DeployStatus.Ready);
        expect(calls).toHaveLength(1);
        expect(calls[0].file).toBe('npx');
        expect(calls[0].args).toEqual([
            '-y',
            'wrangler',
            'pages',
            'deploy',
            path.join(projectDir, 'dist'),
            '--project-name',
            'site--rm--rf--',
            '--account-id',
            'account; rm -rf /',
        ]);
        expect(calls[0].args.some((arg) => arg.includes(apiToken))).toBe(false);
        expect(calls[0].env?.CLOUDFLARE_API_TOKEN).toBe(apiToken);
    });

    it('runs AWS CLI with argv for validation, sync, and invalidation', async () => {
        const calls: ExecFileCall[] = [];
        const projectDir = createProjectDir();
        const deployer = new AWSDeployer({
            bucket: 'bucket; rm -rf /',
            region: 'us-east-1; rm -rf /',
            distributionId: 'dist; rm -rf /',
            execFileSync: (file, args, options) => {
                calls.push({
                    file,
                    args: [...args],
                    env: options.env,
                });
                return args[0] === '--version' ? 'aws-cli/2.0' : '{}';
            },
        });

        const result = await deployer.deploy(createConfig(DeployTarget.AWS, projectDir));

        expect(result.status).toBe(DeployStatus.Ready);
        expect(calls.map((call) => call.file)).toEqual(['aws', 'aws', 'aws']);
        expect(calls[0].args).toEqual(['--version']);
        expect(calls[1].args).toEqual([
            's3',
            'sync',
            path.join(projectDir, 'dist'),
            's3://bucket; rm -rf /',
            '--region',
            'us-east-1; rm -rf /',
            '--delete',
        ]);
        expect(calls[2].args).toEqual([
            'cloudfront',
            'create-invalidation',
            '--distribution-id',
            'dist; rm -rf /',
            '--paths',
            '/*',
        ]);
    });
});
