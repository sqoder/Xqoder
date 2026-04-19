import { describe, expect, it } from 'bun:test';
import type { TextEditMatch } from '../../src/core/agent/lsp.js';
import {
    createDefaultLspTools,
    LspCompletionTool,
    LspDefinitionTool,
    LspFileDiagnosticsTool,
    LspHoverTool,
    LspReferencesTool,
    LspRenameSymbolTool,
    LspWorkspaceSymbolsTool,
} from '../../src/core/agent/tools/lsp-tools.js';
import { formatCompletionMatch, formatDiagnosticMatch } from '../../src/core/agent/tools/lsp-tool-formatters.js';
import { applyTextEditsToContent, groupTextEditsByFile } from '../../src/core/agent/tools/lsp-tool-rename.js';

describe('lsp tools facade', () => {
    it('preserves createDefaultLspTools as the public entrypoint', () => {
        const tools = createDefaultLspTools();

        expect(tools.workspaceSymbols).toBeInstanceOf(LspWorkspaceSymbolsTool);
        expect(tools.fileDiagnostics).toBeInstanceOf(LspFileDiagnosticsTool);
        expect(tools.definition).toBeInstanceOf(LspDefinitionTool);
        expect(tools.references).toBeInstanceOf(LspReferencesTool);
        expect(tools.hover).toBeInstanceOf(LspHoverTool);
        expect(tools.completion).toBeInstanceOf(LspCompletionTool);
        expect(tools.rename).toBeInstanceOf(LspRenameSymbolTool);
        expect(tools.externalManager).toBeUndefined();
    });
});

describe('extracted lsp tool helpers', () => {
    it('groups and applies text edits from latest offsets first', () => {
        const edits: TextEditMatch[] = [
            createEdit('/repo/example.ts', 1, 7, 1, 11, 'BETA'),
            createEdit('/repo/other.ts', 1, 1, 1, 6, 'first'),
            createEdit('/repo/example.ts', 2, 1, 2, 7, 'next'),
        ];

        const grouped = groupTextEditsByFile(edits);

        expect(grouped.get('/repo/example.ts')).toHaveLength(2);
        expect(grouped.get('/repo/other.ts')).toHaveLength(1);
        expect(applyTextEditsToContent('alpha beta gamma\nsecond line', grouped.get('/repo/example.ts') ?? [])).toBe(
            'alpha BETA gamma\nnext line',
        );
    });

    it('rejects overlapping text edits before mutating content', () => {
        const overlappingEdits: TextEditMatch[] = [
            createEdit('/repo/example.ts', 1, 1, 1, 5, 'left'),
            createEdit('/repo/example.ts', 1, 4, 1, 8, 'right'),
        ];

        expect(() => applyTextEditsToContent('abcdefgh', overlappingEdits)).toThrow('Detected overlapping text edits');
    });

    it('formats extracted diagnostic and completion matches consistently', () => {
        expect(formatDiagnosticMatch({
            severity: 'ERROR',
            code: 'TS1000',
            filePath: '/repo/example.ts',
            line: 3,
            character: 9,
            message: 'boom',
        })).toBe('- ERROR TS1000 /repo/example.ts:3:9 boom');

        expect(formatCompletionMatch({
            label: 'calculateTotal',
            kind: 'function',
            detail: '(items: Item[]) => number',
            insertText: 'calculateTotal($1)',
            documentation: 'Sums item prices.',
            resolved: true,
        })).toBe('- calculateTotal [function] [resolved]  (items: Item[]) => number  insert=calculateTotal($1)  Sums item prices.');
    });
});

function createEdit(
    filePath: string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
    newText: string,
): TextEditMatch {
    return {
        filePath,
        startLine,
        startCharacter,
        endLine,
        endCharacter,
        newText,
    };
}
