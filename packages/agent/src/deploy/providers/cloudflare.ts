// ============================================================
// Cloudflare Pages 部署 Provider
// ============================================================

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DeployTarget, DeployStatus, type DeployConfig, type DeployResult } from '@xqoder/shared';
import { BaseDeployer } from '../deployer.js';

/**
 * CloudflareDeployer
 * 使用 Wrangler CLI 部署到 Cloudflare Pages
 */
export class CloudflareDeployer extends BaseDeployer {
    readonly target = DeployTarget.Cloudflare;
    private accountId?: string;
    private apiToken?: string;

    constructor(options?: { accountId?: string; apiToken?: string }) {
        super();
        this.accountId = options?.accountId ?? process.env['CLOUDFLARE_ACCOUNT_ID'];
        this.apiToken = options?.apiToken ?? process.env['CLOUDFLARE_API_TOKEN'];
    }

    async deploy(config: DeployConfig): Promise<DeployResult> {
        const startedAt = new Date();
        const projectName = config.projectName ?? path.basename(config.projectDir);

        try {
            // 1. 验证配置
            const validation = await this.validateConfig(config);
            if (!validation.valid) {
                return this.failureResult(`配置无效: ${validation.errors.join(', ')}`);
            }

            // 2. 构建项目（如果有 build 命令）
            if (config.buildCommand) {
                execSync(config.buildCommand, {
                    cwd: config.projectDir,
                    encoding: 'utf-8',
                    timeout: 300000,
                });
            }

            // 3. 部署到 Cloudflare Pages
            const deployDir = config.outputDir
                ? path.join(config.projectDir, config.outputDir)
                : config.projectDir;

            const deployCmd = this.buildDeployCommand(config, deployDir);
            const output = execSync(deployCmd, {
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
                error: `Cloudflare 部署失败: ${err instanceof Error ? err.message : String(err)}`,
                startedAt,
                completedAt: new Date(),
            };
        }
    }

    async getStatus(deployId: string): Promise<DeployStatus> {
        // Cloudflare Pages 部署是同步的，部署完成即就绪
        return DeployStatus.Ready;
    }

    /** 构建部署命令 */
    private buildDeployCommand(config: DeployConfig, deployDir: string): string {
        const projectName = (config.projectName ?? path.basename(config.projectDir)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const parts = ['npx', '-y', 'wrangler', 'pages', 'deploy', deployDir];

        parts.push('--project-name', projectName);

        if (this.accountId) {
            parts.push('--account-id', this.accountId);
        }

        return parts.join(' ');
    }

    /** 解析部署 URL */
    private parseDeployUrl(output: string, projectName: string): string {
        const urlMatch = output.match(/https:\/\/[^\s]+\.pages\.dev/);
        if (urlMatch) return urlMatch[0];

        // 构造默认 URL
        const safeName = path.basename(projectName).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        return `https://${safeName}.pages.dev`;
    }
}
