// ============================================================
// Cloudflare Pages Deployment Provider
// ============================================================

import {
    execFileSync,
    execSync,
    type ExecFileSyncOptionsWithStringEncoding,
    type ExecSyncOptionsWithStringEncoding,
} from 'node:child_process';
import * as path from 'node:path';
import { DeployTarget, DeployStatus, type DeployConfig, type DeployResult } from '@xqoder/shared';
import { BaseDeployer } from '../deployer.js';

type ExecFileSyncLike = (
    file: string,
    args: string[],
    options: ExecFileSyncOptionsWithStringEncoding,
) => string;

type ExecSyncLike = (
    command: string,
    options: ExecSyncOptionsWithStringEncoding,
) => string;

/**
 * CloudflareDeployer
 * Deploys to Cloudflare Pages using Wrangler CLI
 */
export class CloudflareDeployer extends BaseDeployer {
    readonly target = DeployTarget.Cloudflare;
    private accountId?: string;
    private apiToken?: string;
    private readonly execFile: ExecFileSyncLike;
    private readonly execShell: ExecSyncLike;

    constructor(options?: {
        accountId?: string;
        apiToken?: string;
        execFileSync?: ExecFileSyncLike;
        execSync?: ExecSyncLike;
    }) {
        super();
        this.accountId = options?.accountId ?? process.env['CLOUDFLARE_ACCOUNT_ID'];
        this.apiToken = options?.apiToken ?? process.env['CLOUDFLARE_API_TOKEN'];
        this.execFile = options?.execFileSync ?? ((file, args, execOptions) => execFileSync(file, args, execOptions));
        this.execShell = options?.execSync ?? execSync;
    }

    async deploy(config: DeployConfig): Promise<DeployResult> {
        const startedAt = new Date();
        const projectName = config.projectName ?? path.basename(config.projectDir);

        try {
            // 1. Validate configuration
            const validation = await this.validateConfig(config);
            if (!validation.valid) {
                return this.failureResult(`Invalid configuration: ${validation.errors.join(', ')}`);
            }

            // 2. Build project (if build command exists)
            if (config.buildCommand) {
                this.execShell(config.buildCommand, {
                    cwd: config.projectDir,
                    encoding: 'utf-8',
                    timeout: 300000,
                });
            }

            // 3. Deploy to Cloudflare Pages
            const deployDir = config.outputDir
                ? path.join(config.projectDir, config.outputDir)
                : config.projectDir;

            const deployArgs = this.buildDeployArgs(config, deployDir);
            const output = this.execFile('npx', deployArgs, {
                cwd: config.projectDir,
                encoding: 'utf-8',
                timeout: 300000,
                env: {
                    ...process.env,
                    ...(this.apiToken ? { CLOUDFLARE_API_TOKEN: this.apiToken } : {}),
                    ...(this.accountId ? { CLOUDFLARE_ACCOUNT_ID: this.accountId } : {}),
                    ...config.env,
                },
            });

            const url = this.parseDeployUrl(output, projectName);

            return {
                status: DeployStatus.Ready,
                projectDir: config.projectDir,
                buildCommand: config.buildCommand,
                outputDir: config.outputDir,
                url,
                target: this.target,
                deployId: projectName,
                startedAt,
                completedAt: new Date(),
            };
        } catch (err) {
            return {
                status: DeployStatus.Failed,
                projectDir: config.projectDir,
                buildCommand: config.buildCommand,
                outputDir: config.outputDir,
                target: this.target,
                error: `Cloudflare deployment failed: ${err instanceof Error ? err.message : String(err)}`,
                startedAt,
                completedAt: new Date(),
            };
        }
    }

    async getStatus(_deployId: string): Promise<DeployStatus> {
        // Cloudflare Pages deployment is synchronous, ready upon completion
        return DeployStatus.Ready;
    }

    /** Build deployment argv for Wrangler. */
    private buildDeployArgs(config: DeployConfig, deployDir: string): string[] {
        const projectName = (config.projectName ?? path.basename(config.projectDir)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const args = ['-y', 'wrangler', 'pages', 'deploy', deployDir];

        args.push('--project-name', projectName);

        if (this.accountId) {
            args.push('--account-id', this.accountId);
        }

        return args;
    }

    /** Parse deployment URL */
    private parseDeployUrl(output: string, projectName: string): string {
        const urlMatch = output.match(/https:\/\/[^\s]+\.pages\.dev/);
        if (urlMatch) return urlMatch[0];

        // Construct default URL
        const safeName = path.basename(projectName).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        return `https://${safeName}.pages.dev`;
    }
}
