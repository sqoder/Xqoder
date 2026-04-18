// ============================================================
// Deployer Abstract Base Class
// ============================================================

import type { DeployConfig, DeployResult, DeployStatus, DeployTarget } from '@xqoder/shared';

/**
 * IDeployer Interface
 * All deployment providers must implement this interface
 */
export interface IDeployer {
    /** Deployment target name */
    readonly target: DeployTarget;

    /** Execute deployment */
    deploy(config: DeployConfig): Promise<DeployResult>;

    /** Get deployment status */
    getStatus(deployId: string): Promise<DeployStatus>;

    /** Validate configuration */
    validateConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }>;
}

/**
 * BaseDeployer Base Class
 */
export abstract class BaseDeployer implements IDeployer {
    abstract readonly target: DeployTarget;

    abstract deploy(config: DeployConfig): Promise<DeployResult>;
    abstract getStatus(deployId: string): Promise<DeployStatus>;

    async validateConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        if (!config.projectDir) {
            errors.push('Project directory cannot be empty');
        }

        if (!config.outputDir) {
            errors.push('Output directory cannot be empty');
        }

        return { valid: errors.length === 0, errors };
    }

    /** Create successful deployment result */
    protected successResult(url: string, deployId: string): DeployResult {
        return {
            status: 'ready' as DeployStatus,
            projectDir: '',
            url,
            target: this.target,
            deployId,
            startedAt: new Date(),
            completedAt: new Date(),
        };
    }

    /** Create failed deployment result */
    protected failureResult(error: string): DeployResult {
        return {
            status: 'failed' as DeployStatus,
            projectDir: '',
            target: this.target,
            error,
            startedAt: new Date(),
            completedAt: new Date(),
        };
    }
}
