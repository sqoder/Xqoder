import { describe, expect, it } from 'bun:test';
import { createIdeSnapshot } from '../src/application/system/ide.js';

describe('ide command helpers', () => {
    it('includes the VS Code extension development note in the IDE snapshot', () => {
        const snapshot = createIdeSnapshot({ cwd: '/workspace/demo' }, {});

        expect(snapshot.notes.some((note) => note.includes('apps/vscode-extension'))).toBe(true);
    });

    it('detects VS Code workspaces from env and keeps attach commands quoted for spaced paths', () => {
        const snapshot = createIdeSnapshot(
            { cwd: '/workspace/demo app', host: '0.0.0.0', port: '5050' },
            { VSCODE_CWD: '/workspace/demo app' },
        );

        expect(snapshot.detectedSurfaces).toEqual(['vscode']);
        expect(snapshot.serverUrl).toBe('http://0.0.0.0:5050');
        expect(snapshot.serveCommand).toContain('--dir \"/workspace/demo app\"');
        expect(snapshot.tuiAttachCommand).toContain('--dir \"/workspace/demo app\"');
        expect(snapshot.runAttachCommand).toContain('--attach http://0.0.0.0:5050');
        expect(snapshot.attachCommand).toBe(snapshot.tuiAttachCommand);
        expect(snapshot.acpCommand).toBe(snapshot.runAttachCommand);
    });
});
