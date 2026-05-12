import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { prepareLiveFixtureWorkspace } from '../../scripts/lib/prepare-live-fixture-workspace.js';

describe('prepareLiveFixtureWorkspace', () => {
    let sandbox: string;
    let templateDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-prep-'));
        templateDir = path.join(sandbox, 'template');
        workspaceDir = path.join(sandbox, 'workspaces', 'live-01');
        fs.mkdirSync(path.join(templateDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(templateDir, 'test'), { recursive: true });
        fs.writeFileSync(path.join(templateDir, 'README.md'), 'fixture readme\n');
        fs.writeFileSync(path.join(templateDir, 'src', 'greeter.ts'), 'export const greet = () => "hi";\n');
        fs.writeFileSync(path.join(templateDir, 'test', 'greeter.test.ts'), 'test stub\n');
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    test('copies the template into a fresh workspace directory', () => {
        const result = prepareLiveFixtureWorkspace({ templateDir, workspaceDir });

        expect(result.workspaceDir).toBe(path.resolve(workspaceDir));
        expect(fs.existsSync(path.join(workspaceDir, 'README.md'))).toBe(true);
        expect(fs.readFileSync(path.join(workspaceDir, 'src', 'greeter.ts'), 'utf-8'))
            .toBe('export const greet = () => "hi";\n');
    });

    test('is idempotent: running twice yields the same pristine state', () => {
        prepareLiveFixtureWorkspace({ templateDir, workspaceDir });

        fs.writeFileSync(path.join(workspaceDir, 'src', 'greeter.ts'), 'CORRUPTED\n');
        fs.writeFileSync(path.join(workspaceDir, 'stray.tmp'), 'agent-created noise\n');

        prepareLiveFixtureWorkspace({ templateDir, workspaceDir });

        expect(fs.readFileSync(path.join(workspaceDir, 'src', 'greeter.ts'), 'utf-8'))
            .toBe('export const greet = () => "hi";\n');
        expect(fs.existsSync(path.join(workspaceDir, 'stray.tmp'))).toBe(false);
    });

    test('refuses to clobber the template when workspace equals template', () => {
        expect(() => prepareLiveFixtureWorkspace({ templateDir, workspaceDir: templateDir }))
            .toThrow(/must not equal template/);
    });

    test('throws when the template directory does not exist', () => {
        expect(() => prepareLiveFixtureWorkspace({
            templateDir: path.join(sandbox, 'missing'),
            workspaceDir,
        })).toThrow(/missing or not a directory/);
    });
});
