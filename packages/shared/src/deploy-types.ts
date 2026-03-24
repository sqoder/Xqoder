// ---- Deploy 相关类型 ----

/** 部署目标平台 */
export enum DeployTarget {
    Vercel = 'vercel',
    Cloudflare = 'cloudflare',
    AWS = 'aws',
    Custom = 'custom',
}

/** 部署状态 */
export enum DeployStatus {
    Pending = 'pending',
    Building = 'building',
    Deploying = 'deploying',
    Ready = 'ready',
    Failed = 'failed',
}

/** 标准化部署报告 */
export interface DeployReport {
    status: DeployStatus;
    /** 项目目录 */
    projectDir: string;
    /** 构建命令 */
    buildCommand?: string;
    /** 输出目录 */
    outputDir?: string;
    /** 部署后的 URL */
    url?: string;
    /** 部署目标 */
    target: DeployTarget;
    /** 部署 ID */
    deployId?: string;
    /** 错误信息 */
    error?: string;
    /** 部署开始时间 */
    startedAt: Date;
    /** 部署完成时间 */
    completedAt?: Date;
}

/** 部署结果 */
export type DeployResult = DeployReport;

/** 部署配置 */
export interface DeployConfig {
    target: DeployTarget;
    /** 项目目录 */
    projectDir: string;
    /** 项目名 */
    projectName?: string;
    /** Vercel 团队或个人 scope */
    scope?: string;
    /** 构建命令 */
    buildCommand?: string;
    /** 输出目录 */
    outputDir?: string;
    /** 环境变量 */
    env?: Record<string, string>;
    /** 平台特定配置 */
    platformConfig?: Record<string, unknown>;
}
