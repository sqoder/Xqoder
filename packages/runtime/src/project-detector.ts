// ============================================================
// 项目类型检测器
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectType, type ProjectConfig } from '@xqoder/shared';
import { PackageManagerDetector } from './package-manager-detector.js';

/** 项目检测结果 */
export interface DetectionResult {
    type: ProjectType;
    /** 检测依据 */
    evidence: string;
    /** 检测到的框架（如 react、next、vue 等） */
    framework?: string;
    /** 建议的启动命令 */
    suggestedStartCommand?: string;
    /** 建议的端口 */
    suggestedPort?: number;
}

/**
 * ProjectDetector
 * 自动分析项目目录，识别项目类型和框架
 */
export class ProjectDetector {
    private readonly packageManagerDetector: PackageManagerDetector;

    constructor(packageManagerDetector: PackageManagerDetector = new PackageManagerDetector()) {
        this.packageManagerDetector = packageManagerDetector;
    }

    /**
     * 检测项目类型
     */
    detect(projectDir: string): DetectionResult {
        // Docker 项目
        if (fs.existsSync(path.join(projectDir, 'Dockerfile'))) {
            return {
                type: ProjectType.Docker,
                evidence: 'Dockerfile',
                suggestedStartCommand: 'docker build -t app . && docker run -p 3000:3000 app',
                suggestedPort: 3000,
            };
        }

        // Node.js 项目
        if (fs.existsSync(path.join(projectDir, 'package.json'))) {
            return this.detectNodeProject(projectDir);
        }

        // Python 项目
        if (
            fs.existsSync(path.join(projectDir, 'requirements.txt')) ||
            fs.existsSync(path.join(projectDir, 'pyproject.toml')) ||
            fs.existsSync(path.join(projectDir, 'setup.py'))
        ) {
            return this.detectPythonProject(projectDir);
        }

        // Go 项目
        if (fs.existsSync(path.join(projectDir, 'go.mod'))) {
            return {
                type: ProjectType.Go,
                evidence: 'go.mod',
                suggestedStartCommand: 'go run .',
                suggestedPort: 8080,
            };
        }

        // 静态站点
        if (fs.existsSync(path.join(projectDir, 'index.html'))) {
            return {
                type: ProjectType.Static,
                evidence: 'index.html',
                suggestedStartCommand: 'npx serve .',
                suggestedPort: 3000,
            };
        }

        return { type: ProjectType.Unknown, evidence: '无法识别' };
    }

    /**
     * 生成 ProjectConfig
     */
    createConfig(projectDir: string): ProjectConfig {
        const detection = this.detect(projectDir);
        return {
            rootDir: projectDir,
            type: detection.type,
            name: path.basename(projectDir),
            startCommand: detection.suggestedStartCommand,
            port: detection.suggestedPort,
        };
    }

    /** 检测 Node.js 项目的具体框架 */
    private detectNodeProject(projectDir: string): DetectionResult {
        const pkgPath = path.join(projectDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const deps = {
            ...(pkg['dependencies'] as Record<string, string> ?? {}),
            ...(pkg['devDependencies'] as Record<string, string> ?? {}),
        };
        const scripts = (pkg['scripts'] as Record<string, string>) ?? {};
        const packageManager = this.packageManagerDetector.detect(projectDir);

        // 检测框架
        let framework: string | undefined;
        let startCommand = this.packageManagerScriptOrFallback(projectDir, scripts, 'dev', 'node', ['index.js']);
        let port = 3000;

        if (deps['next']) {
            framework = 'nextjs';
            startCommand = scripts['dev']
                ? this.packageManagerDetector.buildScriptCommand('dev', packageManager)
                : this.packageManagerDetector.buildExecCommand('next', ['dev'], packageManager);
            port = 3000;
        } else if (deps['nuxt']) {
            framework = 'nuxt';
            startCommand = scripts['dev']
                ? this.packageManagerDetector.buildScriptCommand('dev', packageManager)
                : this.packageManagerDetector.buildExecCommand('nuxt', ['dev'], packageManager);
            port = 3000;
        } else if (deps['react-scripts']) {
            framework = 'create-react-app';
            startCommand = scripts['start']
                ? this.packageManagerDetector.buildScriptCommand('start', packageManager)
                : this.packageManagerDetector.buildExecCommand('react-scripts', ['start'], packageManager);
            port = 3000;
        } else if (deps['vite']) {
            framework = 'vite';
            startCommand = scripts['dev']
                ? this.packageManagerDetector.buildScriptCommand('dev', packageManager)
                : this.packageManagerDetector.buildExecCommand('vite', ['dev'], packageManager);
            port = 5173;
        } else if (deps['vue']) {
            framework = 'vue';
            startCommand = scripts['dev']
                ? this.packageManagerDetector.buildScriptCommand('dev', packageManager)
                : this.packageManagerDetector.buildExecCommand('vue-cli-service', ['serve'], packageManager);
            port = 5173;
        } else if (deps['express'] || deps['fastify'] || deps['koa']) {
            framework = deps['express'] ? 'express' : deps['fastify'] ? 'fastify' : 'koa';
            startCommand = scripts['start']
                ? this.packageManagerDetector.buildScriptCommand('start', packageManager)
                : scripts['dev']
                    ? this.packageManagerDetector.buildScriptCommand('dev', packageManager)
                    : 'node index.js';
            port = 3000;
        } else if (scripts['dev']) {
            startCommand = this.packageManagerDetector.buildScriptCommand('dev', packageManager);
        } else if (scripts['start']) {
            startCommand = this.packageManagerDetector.buildScriptCommand('start', packageManager);
        }

        return {
            type: ProjectType.Node,
            evidence: 'package.json',
            framework,
            suggestedStartCommand: startCommand,
            suggestedPort: port,
        };
    }

    private packageManagerScriptOrFallback(
        projectDir: string,
        scripts: Record<string, string>,
        preferredScript: string,
        binary: string,
        args: string[],
    ): string {
        const packageManager = this.packageManagerDetector.detect(projectDir);
        if (scripts[preferredScript]) {
            return this.packageManagerDetector.buildScriptCommand(preferredScript, packageManager);
        }
        return this.packageManagerDetector.buildExecCommand(binary, args, packageManager);
    }

    /** 检测 Python 项目的具体框架 */
    private detectPythonProject(projectDir: string): DetectionResult {
        let framework: string | undefined;
        let startCommand = 'python main.py';
        let port = 8000;

        // 检查 requirements.txt 中的框架
        const reqPath = path.join(projectDir, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            const reqs = fs.readFileSync(reqPath, 'utf-8').toLowerCase();
            if (reqs.includes('django')) {
                framework = 'django';
                startCommand = 'python manage.py runserver';
                port = 8000;
            } else if (reqs.includes('flask')) {
                framework = 'flask';
                startCommand = 'flask run';
                port = 5000;
            } else if (reqs.includes('fastapi')) {
                framework = 'fastapi';
                startCommand = 'uvicorn main:app --reload';
                port = 8000;
            }
        }

        // 检查常见入口文件
        if (!framework) {
            if (fs.existsSync(path.join(projectDir, 'manage.py'))) {
                framework = 'django';
                startCommand = 'python manage.py runserver';
            } else if (fs.existsSync(path.join(projectDir, 'app.py'))) {
                startCommand = 'python app.py';
            } else if (fs.existsSync(path.join(projectDir, 'main.py'))) {
                startCommand = 'python main.py';
            }
        }

        return {
            type: ProjectType.Python,
            evidence: fs.existsSync(reqPath) ? 'requirements.txt' : 'pyproject.toml',
            framework,
            suggestedStartCommand: startCommand,
            suggestedPort: port,
        };
    }
}
