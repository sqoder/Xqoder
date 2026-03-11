import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageManagerDetector } from './package-manager-detector.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-runtime-pm-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('PackageManagerDetector', () => {
    it('detects pnpm from pnpm-lock.yaml', () => {
        const dir = createTempDir();
        fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');

        const detector = new PackageManagerDetector();
        expect(detector.detect(dir)).toBe('pnpm');
        expect(detector.buildScriptCommand('dev', 'pnpm')).toBe('pnpm run dev');
    });

    it('detects yarn from yarn.lock', () => {
        const dir = createTempDir();
        fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

        const detector = new PackageManagerDetector();
        expect(detector.detect(dir)).toBe('yarn');
        expect(detector.buildScriptCommand('start', 'yarn')).toBe('yarn start');
    });

    it('falls back to npm when no lock file exists', () => {
        const dir = createTempDir();

        const detector = new PackageManagerDetector();
        expect(detector.detect(dir)).toBe('npm');
        expect(detector.buildExecCommand('next', ['dev'], 'npm')).toBe('npx next dev');
    });
});
