// ============================================================
// Deployer 抽象基类
// ============================================================

import type { DeployConfig, DeployResult, DeployStatus, DeployTarget } from '@xqoder/shared';

/**
 * IDeployer 接口
 * 所有部署 Provider 必须实现此接口
 */
export interface IDeployer {
    /** 部署目标名称 */
    readonly target: DeployTarget;

    /** 执行部署 */
    deploy(config: DeployConfig): Promise<DeployResult>;

    /** 获取部署状态 */
    getStatus(deployId: string): Promise<DeployStatus>;

    /** 验证配置 */
    validateConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }>;
}

/**
 * BaseDeployer 基类
 */
export abstract class BaseDeployer implements IDeployer {
    abstract readonly target: DeployTarget;

    abstract deploy(config: DeployConfig): Promise<DeployResult>;
    abstract getStatus(deployId: string): Promise<DeployStatus>;

    async validateConfig(config: DeployConfig): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        if (!config.projectDir) {
            errors.push('项目目录不能为空');
        }

        if (!config.outputDir) {
            errors.push('输出目录不能为空');
        }

        return { valid: errors.length === 0, errors };
    }

    /** 创建成功的部署结果 */
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

    /** 创建失败的部署结果 */
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
