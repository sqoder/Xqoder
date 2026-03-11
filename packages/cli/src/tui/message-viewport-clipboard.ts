import { spawnSync } from 'node:child_process';

function getCopyCommand(): { cmd: string; args: string[] } | undefined {
    if (process.platform === 'darwin') return { cmd: 'pbcopy', args: [] };
    if (process.platform === 'win32') return { cmd: 'clip', args: [] };
    if (process.env.DISPLAY) return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
    return undefined;
}

export function copyTranscriptSelectionToClipboard(text: string): boolean {
    const spec = getCopyCommand();
    if (!spec) {
        return false;
    }

    try {
        spawnSync(spec.cmd, spec.args, { input: text, encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}
