// ---- 项目相关类型 ----

/** 项目类型枚举 */
export enum ProjectType {
    Node = 'node',
    Python = 'python',
    Docker = 'docker',
    Go = 'go',
    Static = 'static',
    Unknown = 'unknown',
}

/** 项目配置 */
export interface ProjectConfig {
    /** 项目根目录 */
    rootDir: string;
    /** 项目类型 */
    type: ProjectType;
    /** 项目名称 */
    name: string;
    /** 入口文件 */
    entryPoint?: string;
    /** 启动命令 */
    startCommand?: string;
    /** 开发端口 */
    port?: number;
    /** 环境变量 */
    env?: Record<string, string>;
}

/** Node 项目包管理器 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'unknown';
