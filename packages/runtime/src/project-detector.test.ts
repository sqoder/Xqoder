import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectType } from '@xqoder/shared';
import { ProjectDetector } from './project-detector.js';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-runtime-project-'));
    tempDirs.push(dir);
    return dir;
}

function writePackageJson(dir: string, pkg: Record<string, unknown>): void {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('ProjectDetector', () => {
    it('uses pnpm-aware commands for Vite projects', () => {
        const dir = createTempDir();
        writePackageJson(dir, {
            scripts: { dev: 'vite', build: 'vite build' },
            dependencies: { vite: '^5.0.0' },
        });
        fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');

        const detector = new ProjectDetector();
        const detection = detector.detect(dir);

        expect(detection.type).toBe(ProjectType.Node);
        expect(detection.framework).toBe('vite');
        expect(detection.suggestedStartCommand).toBe('pnpm run dev');
        expect(detection.suggestedPort).toBe(5173);
    });

    it('falls back to binary execution when Next.js has no dev script', () => {
        const dir = createTempDir();
        writePackageJson(dir, {
            dependencies: { next: '^15.0.0' },
        });
        fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

        const detector = new ProjectDetector();
        const detection = detector.detect(dir);

        expect(detection.framework).toBe('nextjs');
        expect(detection.suggestedStartCommand).toBe('yarn next dev');
        expect(detection.suggestedPort).toBe(3000);
    });
});
