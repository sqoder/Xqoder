import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { SandboxAccessError, resolvePathWithinProject } from '../../src/core/agent/tools/sandbox.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-sandbox-path-'));
    tempDirs.push(dir);
    return dir;
}

describe('sandbox path resolution', () => {
    it('rejects new files below workspace symlinked directories that resolve outside the project root', () => {
        const root = createTempDir();
        const projectRoot = path.join(root, 'project');
        const outsideDir = path.join(root, 'outside');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });

        const linkPath = path.join(projectRoot, 'outside-link');
        fs.symlinkSync(path.relative(projectRoot, outsideDir), linkPath);

        let thrown: unknown;
        try {
            resolvePathWithinProject('outside-link/new-file.txt', {
                cwd: projectRoot,
                projectRoot,
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(SandboxAccessError);
        const sandboxError = thrown as SandboxAccessError;
        expect(path.normalize(sandboxError.resolvedPath)).toBe(path.join(fs.realpathSync.native(outsideDir), 'new-file.txt'));
    });
});
