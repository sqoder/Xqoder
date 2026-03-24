// ============================================================
// 部署配置生成器
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DeployTarget, type DeployConfig } from '@xqoder/shared';
import { sanitizeProjectName } from './project-name.js';

/** 框架部署配置映射 */
interface FrameworkDeployPreset {
    buildCommand: string;
    outputDir: string;
}

const FRAMEWORK_PRESETS: Record<string, FrameworkDeployPreset> = {
    nextjs: {
        buildCommand: 'npm run build',
        outputDir: '.next',
    },
    'create-react-app': {
        buildCommand: 'npm run build',
        outputDir: 'build',
    },
    vite: {
        buildCommand: 'npm run build',
        outputDir: 'dist',
    },
    vue: {
        buildCommand: 'npm run build',
        outputDir: 'dist',
    },
    nuxt: {
        buildCommand: 'npm run build',
        outputDir: '.output/public',
    },
};

/**
 * DeployConfigGenerator
 * 根据项目类型和框架自动生成部署配置
 */
export class DeployConfigGenerator {
    /**
     * 自动生成部署配置
     */
    generate(
        projectDir: string,
        target?: DeployTarget,
        framework?: string,
    ): DeployConfig {
        const projectName = path.basename(projectDir);

        // 检测框架
        const detectedFramework = framework ?? this.detectFramework(projectDir);
        const preset = detectedFramework ? FRAMEWORK_PRESETS[detectedFramework] : undefined;

        const deployTarget = target ?? DeployTarget.Vercel;

        return {
            target: deployTarget,
            projectDir,
            projectName: sanitizeProjectName(this.detectProjectName(projectDir) ?? projectName),
            buildCommand: preset?.buildCommand ?? this.detectBuildCommand(projectDir),
            outputDir: preset?.outputDir ?? this.detectOutputDir(projectDir),
            env: {},
        };
    }

    /**
     * 获取推荐的部署目标
     */
    getRecommendedTarget(projectDir: string): DeployTarget {
        return DeployTarget.Vercel;
    }

    /** 检测框架 */
    private detectFramework(projectDir: string): string | undefined {
        const pkgPath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return undefined;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const deps = {
            ...(pkg['dependencies'] as Record<string, string> ?? {}),
            ...(pkg['devDependencies'] as Record<string, string> ?? {}),
        };

        if (deps['next']) return 'nextjs';
        if (deps['nuxt']) return 'nuxt';
        if (deps['react-scripts']) return 'create-react-app';
        if (deps['vite']) return 'vite';
        if (deps['vue']) return 'vue';

        return undefined;
    }

    /** 检测构建命令 */
    private detectBuildCommand(projectDir: string): string | undefined {
        const pkgPath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return undefined;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const scripts = pkg['scripts'] as Record<string, string> | undefined;

        if (scripts?.['build']) return 'npm run build';
        return undefined;
    }

    /** 检测项目名 */
    private detectProjectName(projectDir: string): string | undefined {
        const pkgPath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return undefined;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        return typeof pkg['name'] === 'string' ? pkg['name'] : undefined;
    }

    /** 检测输出目录 */
    private detectOutputDir(projectDir: string): string | undefined {
        // 常见的输出目录
        const candidates = ['dist', 'build', 'out', '.next', 'public'];
        for (const dir of candidates) {
            if (fs.existsSync(path.join(projectDir, dir))) {
                return dir;
            }
        }
        return 'dist';
    }
}
