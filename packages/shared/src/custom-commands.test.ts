import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listCustomCommandReferences, loadCustomCommands, resolveCustomCommand } from './custom-commands.js';

const tempDirs: string[] = [];

function mkTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-custom-command-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) continue;
        fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.XDG_CONFIG_HOME;
});

describe('custom command namespaces', () => {
    it('keeps project command as default while exposing user:/project: scoped lookup', () => {
        const xdg = mkTmpDir();
        const projectDir = mkTmpDir();
        process.env.XDG_CONFIG_HOME = xdg;

        const userCommandsDir = path.join(xdg, 'xqoder', 'commands');
        const projectCommandsDir = path.join(projectDir, '.xqoder', 'commands');
        fs.mkdirSync(userCommandsDir, { recursive: true });
        fs.mkdirSync(projectCommandsDir, { recursive: true });

        fs.writeFileSync(path.join(userCommandsDir, 'deploy.md'), 'user deploy', 'utf8');
        fs.writeFileSync(path.join(projectCommandsDir, 'deploy.md'), 'project deploy', 'utf8');

        const merged = loadCustomCommands(projectDir);
        expect(merged.find((command) => command.name === 'deploy')?.content).toBe('project deploy');

        expect(resolveCustomCommand('deploy', projectDir)?.content).toBe('project deploy');
        expect(resolveCustomCommand('project:deploy', projectDir)?.content).toBe('project deploy');
        expect(resolveCustomCommand('user:deploy', projectDir)?.content).toBe('user deploy');

        const refs = listCustomCommandReferences(projectDir).map((ref) => ref.id);
        expect(refs).toContain('deploy');
        expect(refs).toContain('user:deploy');
        expect(refs).toContain('project:deploy');
    });
});
