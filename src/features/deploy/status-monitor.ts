// ============================================================
// Deployment Status Monitor
// ============================================================

import type { DeployStatus } from '@xqoder/shared';
import { Logger, logger as defaultLogger } from '@xqoder/shared';
import type { IDeployer } from './deployer.js';

/** Status polling callbacks */
export interface StatusMonitorCallbacks {
    onStatusChange?: (status: DeployStatus) => void;
    onReady?: (url: string) => void;
    onFailed?: (error: string) => void;
}

/**
 * DeployStatusMonitor
 * Polls and monitors deployment status
 */
export class DeployStatusMonitor {
    private logger: Logger;
    private pollInterval: number;
    private maxPollTime: number;

    constructor(pollInterval: number = 5000, maxPollTime: number = 300000) {
        this.logger = defaultLogger.child('DeployMonitor');
        this.pollInterval = pollInterval;
        this.maxPollTime = maxPollTime;
    }

    /**
     * Wait for deployment to complete
     */
    async waitForReady(
        deployer: IDeployer,
        deployId: string,
        callbacks?: StatusMonitorCallbacks,
    ): Promise<DeployStatus> {
        const startTime = Date.now();
        let lastStatus: DeployStatus | null = null;

        while (Date.now() - startTime < this.maxPollTime) {
            const status = await deployer.getStatus(deployId);

            if (status !== lastStatus) {
                this.logger.info(`Deployment status: ${status}`);
                callbacks?.onStatusChange?.(status);
                lastStatus = status;
            }

            if (status === 'ready') {
                callbacks?.onReady?.(deployId);
                return status;
            }

            if (status === 'failed') {
                callbacks?.onFailed?.('Deployment failed');
                return status;
            }

            await this.sleep(this.pollInterval);
        }

        this.logger.error('Deployment monitoring timed out');
        callbacks?.onFailed?.('Deployment monitoring timed out');
        return 'failed' as DeployStatus;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
