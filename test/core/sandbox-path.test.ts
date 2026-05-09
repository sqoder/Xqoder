import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    SandboxAccessError,
    resolvePathForRead,
    resolvePathWithinProject,
} from '../../src/core/agent/tools/sandbox.js';

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

    it('allows a specifically approved outside-workspace read path without full-access', () => {
        const root = createTempDir();
        const projectRoot = path.join(root, 'project');
        const outsideDir = path.join(root, 'outside');
        const outsideFile = path.join(outsideDir, 'notes.txt');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.writeFileSync(outsideFile, 'notes', 'utf-8');

        const resolved = resolvePathForRead('../outside/notes.txt', {
            cwd: projectRoot,
            projectRoot,
            sandboxMode: 'project',
            approvedReadPaths: ['../outside/notes.txt'],
        });

        expect(path.normalize(resolved)).toBe(path.normalize(outsideFile));
    });

    it('matches approved outside-workspace reads by realpath when the original target is a symlink', () => {
        const root = createTempDir();
        const projectRoot = path.join(root, 'project');
        const outsideDir = path.join(root, 'outside');
        const outsideFile = path.join(outsideDir, 'notes.txt');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.writeFileSync(outsideFile, 'notes', 'utf-8');

        const outsideLink = path.join(projectRoot, 'outside-link');
        fs.symlinkSync(path.relative(projectRoot, outsideDir), outsideLink);

        const resolved = resolvePathForRead('outside-link/notes.txt', {
            cwd: projectRoot,
            projectRoot,
            sandboxMode: 'project',
            approvedReadPaths: [outsideFile],
        });

        expect(path.normalize(resolved)).toBe(path.normalize(path.join(projectRoot, 'outside-link', 'notes.txt')));
    });

    it('allows outside-workspace reads directly in full-access mode', () => {
        const root = createTempDir();
        const projectRoot = path.join(root, 'project');
        const outsideDir = path.join(root, 'outside');
        const outsideFile = path.join(outsideDir, 'report.docx');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.writeFileSync(outsideFile, 'fake-docx', 'utf-8');

        const resolved = resolvePathForRead(outsideFile, {
            cwd: projectRoot,
            projectRoot,
            sandboxMode: 'full-access',
        });

        expect(path.normalize(resolved)).toBe(path.normalize(outsideFile));
    });
});
