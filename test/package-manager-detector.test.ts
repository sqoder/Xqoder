import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { DeployConfigGenerator } from '../src/features/deploy/config-generator.js';
import { PackageManagerDetector } from '../src/features/runtime/package-manager-detector.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('package manager detector', () => {
    it('prefers Bun when bun.lock is present', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'bun.lock'), '', 'utf-8');

        const detector = new PackageManagerDetector();

        expect(detector.detect(cwd)).toBe('bun');
        expect(detector.buildScriptCommand('build', 'bun')).toBe('bun run build');
        expect(detector.buildExecCommand('vite', ['dev'], 'bun')).toBe('bunx vite dev');
    });
});

describe('deploy config generator', () => {
    it('uses Bun build commands for Bun projects', () => {
        const cwd = createTempDir();
        fs.writeFileSync(path.join(cwd, 'bun.lock'), '', 'utf-8');
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
            name: 'bun-app',
            scripts: {
                build: 'vite build',
            },
            devDependencies: {
                vite: '^5.0.0',
            },
        }, null, 2));

        const generator = new DeployConfigGenerator();
        const config = generator.generate(cwd);

        expect(config.buildCommand).toBe('bun run build');
        expect(config.outputDir).toBe('dist');
    });
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-package-manager-'));
    tempDirs.push(dir);
    return dir;
}
