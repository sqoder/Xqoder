// ============================================================
// Vercel Deployment Provider
// ============================================================

import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DeployTarget, DeployStatus, type DeployConfig, type DeployResult } from '@xqoder/shared';
import { BaseDeployer } from '../deployer.js';
import { sanitizeProjectName } from '../project-name.js';

type ExecSyncLike = (
    command: string,
    options: ExecSyncOptionsWithStringEncoding,
) => string;

type FetchLike = (
    input: string,
    init?: {
        method?: string;
        redirect?: 'follow' | 'manual' | 'error';
    },
) => Promise<{ status: number }>;

/**
 * VercelDeployer
 * Uses Vercel CLI for deployment
 */
export class VercelDeployer extends BaseDeployer {
    readonly target = DeployTarget.Vercel;
    private token?: string;
    private scope?: string;
    private readonly exec: ExecSyncLike;
    private readonly fetch: FetchLike;

    constructor(options: {
        token?: string;
        scope?: string;
        execSync?: ExecSyncLike;
        fetch?: FetchLike;
    } = {}) {
        super();
        this.token = options.token ?? process.env['VERCEL_TOKEN'];
        this.scope = options.scope ?? process.env['XQODER_VERCEL_SCOPE'];
        this.exec = options.execSync ?? execSync;
        this.fetch = options.fetch ?? fetch;
    }

    async deploy(config: DeployConfig): Promise<DeployResult> {
        const startedAt = new Date();
        let cleanupDeployDir = () => {};

        try {
            // 1. Validate configuration
            const validation = await this.validateConfig(config);
            if (!validation.valid) {
                return this.failureResult(`Invalid configuration: ${validation.errors.join(', ')}`);
            }

            // 2. Ensure vercel.json exists
            await this.ensureVercelConfig(config);

            // 3. Execute deployment
            const deployDirContext = this.prepareDeployDirectory(config);
            cleanupDeployDir = deployDirContext.cleanup;
            const deployCmd = this.buildDeployCommand(config);
            const output = this.exec(deployCmd, {
                cwd: deployDirContext.deployDir,
                encoding: 'utf-8',
                timeout: 300000, // 5 minute timeout
                env: {
                    ...process.env,
                    ...(this.token ? { VERCEL_TOKEN: this.token } : {}),
                    ...config.env,
                },
            });

            // Parse deployment URL
            const url = this.parseDeployUrl(output);
            if (!url) {
                return {
                    status: DeployStatus.Failed,
                    projectDir: config.projectDir,
                    buildCommand: config.buildCommand,
                    outputDir: config.outputDir,
                    target: this.target,
                    error: 'Vercel deployment failed: Failed to parse deployment URL from CLI output',
                    startedAt,
                    completedAt: new Date(),
                };
            }
            await this.verifyDeployment(url);

            return {
                status: DeployStatus.Ready,
                projectDir: config.projectDir,
                buildCommand: config.buildCommand,
                outputDir: config.outputDir,
                url,
                target: this.target,
                deployId: this.extractDeployId(url),
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
                error: `Vercel deployment failed: ${err instanceof Error ? err.message : String(err)}`,
                startedAt,
                completedAt: new Date(),
            };
        } finally {
            cleanupDeployDir();
        }
    }

    async getStatus(deployId: string): Promise<DeployStatus> {
        try {
            const tokenFlag = this.token ? `--token ${this.token}` : '';
            const scopeFlag = this.scope ? ` --scope ${this.scope}` : '';
            const output = this.exec(
                `npx -y vercel inspect ${deployId} ${tokenFlag}${scopeFlag}`,
                { encoding: 'utf-8', timeout: 30000 },
            );
            if (output.includes('READY')) return DeployStatus.Ready;
            if (output.includes('BUILDING')) return DeployStatus.Building;
            if (output.includes('ERROR')) return DeployStatus.Failed;
            return DeployStatus.Deploying;
        } catch {
            return DeployStatus.Failed;
        }
    }

    /** Generate vercel.json configuration file */
    private async ensureVercelConfig(config: DeployConfig): Promise<void> {
        const configPath = path.join(config.projectDir, 'vercel.json');
        if (fs.existsSync(configPath)) return;

        const vercelConfig: Record<string, unknown> = {
            version: 2,
        };

        if (config.buildCommand) {
            vercelConfig['buildCommand'] = config.buildCommand;
        }
        if (config.outputDir) {
            vercelConfig['outputDirectory'] = config.outputDir;
        }

        // Platform specific configuration
        if (config.platformConfig) {
            Object.assign(vercelConfig, config.platformConfig);
        }

        fs.writeFileSync(configPath, JSON.stringify(vercelConfig, null, 2), 'utf-8');
    }

    /** Build deployment command */
    private buildDeployCommand(config: DeployConfig): string {
        const parts = ['npx', '-y', 'vercel', '--yes'];

        if (this.token) {
            parts.push('--token', this.token);
        }

        const resolvedScope = config.scope ?? this.scope;
        if (resolvedScope) {
            parts.push('--scope', resolvedScope);
        }

        // Production deployment
        parts.push('--prod');

        return `${parts.join(' ')} 2>&1`;
    }

    private prepareDeployDirectory(config: DeployConfig): {
        deployDir: string;
        cleanup: () => void;
    } {
        const desiredProjectName = sanitizeProjectName(
            config.projectName ?? path.basename(config.projectDir),
        );
        const currentDirName = path.basename(config.projectDir);

        if (currentDirName === desiredProjectName) {
            return {
                deployDir: config.projectDir,
                cleanup: () => {},
            };
        }

        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-vercel-deploy-'));
        const aliasDir = path.join(tempRoot, desiredProjectName);
        fs.cpSync(config.projectDir, aliasDir, {
            recursive: true,
            filter: (source) => {
                const relativePath = path.relative(config.projectDir, source);

                if (!relativePath) {
                    return true;
                }

                const topLevelName = relativePath.split(path.sep)[0] ?? '';
                return topLevelName !== 'node_modules' && topLevelName !== '.git';
            },
        });

        return {
            deployDir: aliasDir,
            cleanup: () => {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            },
        };
    }

    /** Parse deployment URL */
    private parseDeployUrl(output: string): string | undefined {
        const cleanedOutput = output.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
        const aliasMatches = cleanedOutput.match(/Aliased:\s+(https:\/\/[^\s]+\.vercel\.app)/g);
        if (aliasMatches && aliasMatches.length > 0) {
            const lastAlias = aliasMatches[aliasMatches.length - 1];
            return lastAlias?.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
        }

        const productionMatches = cleanedOutput.match(/Production:\s+(https:\/\/[^\s]+\.vercel\.app)/g);
        if (productionMatches && productionMatches.length > 0) {
            const lastProduction = productionMatches[productionMatches.length - 1];
            return lastProduction?.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
        }

        const matches = cleanedOutput.match(/https:\/\/[^\s]+\.vercel\.app/g);
        return matches?.[matches.length - 1];
    }

    /** Extract deployment ID */
    private extractDeployId(url: string): string {
        return url.replace('https://', '').split('.')[0] ?? '';
    }

    /** Verify deployment is accessible */
    private async verifyDeployment(url: string): Promise<void> {
        let lastStatus: number | undefined;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            for (const method of ['HEAD', 'GET'] as const) {
                const response = await this.fetch(url, {
                    method,
                    redirect: 'follow',
                });

                lastStatus = response.status;
                if (response.status < 400) {
                    return;
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        throw new Error(`Deployment verification failed, HTTP ${lastStatus ?? 'unknown'}`);
    }
}
