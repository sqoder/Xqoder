// ============================================================
// Deployment Configuration Generator
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DeployTarget, type DeployConfig } from '@xqoder/shared';
import { sanitizeProjectName } from './project-name.js';

/** Framework deployment configuration presets */
interface FrameworkDeployPreset {
    outputDir: string;
}

const FRAMEWORK_PRESETS: Record<string, FrameworkDeployPreset> = {
    nextjs: {
        outputDir: '.next',
    },
    'create-react-app': {
        outputDir: 'build',
    },
    vite: {
        outputDir: 'dist',
    },
    vue: {
        outputDir: 'dist',
    },
    nuxt: {
        outputDir: '.output/public',
    },
};

/**
 * DeployConfigGenerator
 * Automatically generates deployment configuration based on project type and framework
 */
export class DeployConfigGenerator {
    /**
     * Automatically generates deployment configuration
     */
    generate(
        projectDir: string,
        target?: DeployTarget,
        framework?: string,
    ): DeployConfig {
        const projectName = path.basename(projectDir);

        // Detect framework
        const detectedFramework = framework ?? this.detectFramework(projectDir);
        const preset = detectedFramework ? FRAMEWORK_PRESETS[detectedFramework] : undefined;

        const deployTarget = target ?? DeployTarget.Vercel;

        return {
            target: deployTarget,
            projectDir,
            projectName: sanitizeProjectName(this.detectProjectName(projectDir) ?? projectName),
            buildCommand: this.detectBuildCommand(projectDir),
            outputDir: preset?.outputDir ?? this.detectOutputDir(projectDir),
            env: {},
        };
    }

    /**
     * Get recommended deployment target
     */
    getRecommendedTarget(_projectDir: string): DeployTarget {
        return DeployTarget.Vercel;
    }

    /** Detect framework */
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

    /** Detect build command */
    private detectBuildCommand(projectDir: string): string | undefined {
        const pkgPath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return undefined;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const scripts = pkg['scripts'] as Record<string, string> | undefined;

        if (scripts?.['build']) return this.buildScriptCommand(projectDir, 'build');
        return undefined;
    }

    private buildScriptCommand(projectDir: string, scriptName: string): string {
        if (fs.existsSync(path.join(projectDir, 'bun.lock')) || fs.existsSync(path.join(projectDir, 'bun.lockb'))) {
            return `bun run ${scriptName}`;
        }
        if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) {
            return `pnpm run ${scriptName}`;
        }
        if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) {
            return `yarn ${scriptName}`;
        }
        return `npm run ${scriptName}`;
    }

    /** Detect project name */
    private detectProjectName(projectDir: string): string | undefined {
        const pkgPath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(pkgPath)) return undefined;

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        return typeof pkg['name'] === 'string' ? pkg['name'] : undefined;
    }

    /** Detect output directory */
    private detectOutputDir(projectDir: string): string | undefined {
        // Common output directories
        const candidates = ['dist', 'build', 'out', '.next', 'public'];
        for (const dir of candidates) {
            if (fs.existsSync(path.join(projectDir, dir))) {
                return dir;
            }
        }
        return 'dist';
    }
}
