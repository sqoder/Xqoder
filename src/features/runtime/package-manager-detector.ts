// ============================================================
// Package Manager Detection and Command Building
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageManager } from '@xqoder/shared';

export class PackageManagerDetector {
    detect(projectDir: string): PackageManager {
        if (fs.existsSync(path.join(projectDir, 'bun.lock')) || fs.existsSync(path.join(projectDir, 'bun.lockb'))) return 'bun';
        if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) return 'yarn';
        return 'npm';
    }

    buildScriptCommand(scriptName: string, packageManager: PackageManager): string {
        switch (packageManager) {
            case 'bun':
                return `bun run ${scriptName}`;
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
            case 'bun':
                return `bunx ${suffix}`;
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
