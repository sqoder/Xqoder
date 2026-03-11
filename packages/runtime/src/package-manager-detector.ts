// ============================================================
// 包管理器检测与命令构建
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageManager } from '@xqoder/shared';

export class PackageManagerDetector {
    detect(projectDir: string): PackageManager {
        if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) return 'yarn';
        return 'npm';
    }

    buildScriptCommand(scriptName: string, packageManager: PackageManager): string {
        switch (packageManager) {
            case 'pnpm':
                return `pnpm run ${scriptName}`;
            case 'yarn':
                return `yarn ${scriptName}`;
            case 'npm':
            default:
                return scriptName === 'start' ? 'npm start' : `npm run ${scriptName}`;
        }
    }

    buildExecCommand(binary: string, args: string[], packageManager: PackageManager): string {
        const suffix = [binary, ...args].join(' ');

        switch (packageManager) {
            case 'pnpm':
                return `pnpm exec ${suffix}`;
            case 'yarn':
                return `yarn ${suffix}`;
            case 'npm':
            default:
                return `npx ${suffix}`;
        }
    }
}
