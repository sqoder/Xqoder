import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PrepareLiveFixtureWorkspaceInput {
    templateDir: string;
    workspaceDir: string;
}

export interface PrepareLiveFixtureWorkspaceResult {
    templateDir: string;
    workspaceDir: string;
}

export function prepareLiveFixtureWorkspace(
    input: PrepareLiveFixtureWorkspaceInput,
): PrepareLiveFixtureWorkspaceResult {
    const templateDir = path.resolve(input.templateDir);
    const workspaceDir = path.resolve(input.workspaceDir);

    if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
        throw new Error(`Live fixture template is missing or not a directory: ${templateDir}`);
    }
    if (workspaceDir === templateDir) {
        throw new Error('Live fixture workspace must not equal template (refusing to clobber template)');
    }
    if (templateDir.startsWith(`${workspaceDir}${path.sep}`)) {
        throw new Error('Live fixture workspace must not contain its own template (refusing recursive copy)');
    }

    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(workspaceDir), { recursive: true });
    fs.cpSync(templateDir, workspaceDir, { recursive: true });

    return { templateDir, workspaceDir };
}
