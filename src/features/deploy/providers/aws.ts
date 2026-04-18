// ============================================================
// AWS S3 + CloudFront Deployment Provider
// ============================================================

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { DeployTarget, DeployStatus, type DeployConfig, type DeployResult } from '@xqoder/shared';
import { BaseDeployer } from '../deployer.js';

/**
 * AWSDeployer
 * Deploys static sites to S3 + CloudFront using AWS CLI
 */
export class AWSDeployer extends BaseDeployer {
    readonly target = DeployTarget.AWS;
    private bucket?: string;
    private region: string;
    private distributionId?: string;

    constructor(options?: {
        bucket?: string;
        region?: string;
        distributionId?: string;
    }) {
        super();
        this.bucket = options?.bucket ?? process.env['AWS_S3_BUCKET'];
        this.region = options?.region ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
        this.distributionId = options?.distributionId ?? process.env['AWS_CLOUDFRONT_DISTRIBUTION_ID'];
    }

    async deploy(config: DeployConfig): Promise<DeployResult> {
        const startedAt = new Date();
        const bucket = this.bucket ?? config.platformConfig?.['bucket'] as string;

        if (!bucket) {
            return this.failureResult('AWS S3 bucket not configured. Please set AWS_S3_BUCKET environment variable or specify bucket in configuration.');
        }

        try {
            // 1. Validate configuration
            const validation = await this.validateConfig(config);
            if (!validation.valid) {
                return this.failureResult(`Invalid configuration: ${validation.errors.join(', ')}`);
            }

            // 2. Build project
            if (config.buildCommand) {
                execSync(config.buildCommand, {
                    cwd: config.projectDir,
                    encoding: 'utf-8',
                    timeout: 300_000,
                });
            }

            // 3. Sync to S3
            const deployDir = config.outputDir
                ? path.join(config.projectDir, config.outputDir)
                : config.projectDir;

            const syncCmd = [
                'aws', 's3', 'sync',
                deployDir,
                `s3://${bucket}`,
                '--region', this.region,
                '--delete',
            ].join(' ');

            execSync(syncCmd, {
                cwd: config.projectDir,
                encoding: 'utf-8',
                timeout: 300_000,
                env: { ...process.env, ...config.env },
            });

            // 4. Create CloudFront invalidation if distributionId exists
            if (this.distributionId) {
                const invalidateCmd = [
                    'aws', 'cloudfront', 'create-invalidation',
                    '--distribution-id', this.distributionId,
                    '--paths', '"/*"',
                ].join(' ');

                try {
                    execSync(invalidateCmd, {
                        cwd: config.projectDir,
                        encoding: 'utf-8',
                        timeout: 60_000,
                        env: { ...process.env, ...config.env },
                    });
                } catch {
                    // Invalidation failure does not block deployment
                }
            }

            // 5. Construct URL
            const url = this.distributionId
                ? `https://${this.distributionId}.cloudfront.net`
                : `http://${bucket}.s3-website-${this.region}.amazonaws.com`;

            return {
                status: DeployStatus.Ready,
                projectDir: config.projectDir,
                buildCommand: config.buildCommand,
                outputDir: config.outputDir,
                url,
                target: this.target,
                deployId: `s3://${bucket}`,
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
                error: `AWS deployment failed: ${err instanceof Error ? err.message : String(err)}`,
                startedAt,
                completedAt: new Date(),
            };
        }
    }

    async getStatus(_deployId: string): Promise<DeployStatus> {
        // S3 deployment is synchronous
        return DeployStatus.Ready;
    }

    override async validateConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }> {
        const base = await super.validateConfig(config);
        const errors = [...base.errors];

        const bucket = this.bucket ?? config.platformConfig?.['bucket'];
        if (!bucket) {
            errors.push('AWS S3 bucket not configured');
        }

        // Check if AWS CLI is available
        try {
            execSync('aws --version', { encoding: 'utf-8', timeout: 5000 });
        } catch {
            errors.push('AWS CLI not installed or not in PATH');
        }

        return { valid: errors.length === 0, errors };
    }
}
