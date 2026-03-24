// ============================================================
// 部署状态监控
// ============================================================

import type { DeployStatus, DeployTarget } from '@xqoder/shared';
import { Logger, logger as defaultLogger } from '@xqoder/shared';
import type { IDeployer } from './deployer.js';

/** 状态轮询回调 */
export interface StatusMonitorCallbacks {
    onStatusChange?: (status: DeployStatus) => void;
    onReady?: (url: string) => void;
    onFailed?: (error: string) => void;
}

/**
 * DeployStatusMonitor
 * 轮询监控部署状态
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
     * 等待部署完成
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
                this.logger.info(`部署状态: ${status}`);
                callbacks?.onStatusChange?.(status);
                lastStatus = status;
            }

            if (status === 'ready') {
                callbacks?.onReady?.(deployId);
                return status;
            }

            if (status === 'failed') {
                callbacks?.onFailed?.('部署失败');
                return status;
            }

            await this.sleep(this.pollInterval);
        }

        this.logger.error('部署监控超时');
        callbacks?.onFailed?.('部署监控超时');
        return 'failed' as DeployStatus;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
