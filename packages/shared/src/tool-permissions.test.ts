import { describe, expect, it } from 'vitest';
import { getPermissionKeyForTool, normalizePermissionMode, resolveToolPermissionMode } from './tool-permissions.js';

describe('tool permissions', () => {
    it('maps tool aliases to permission keys', () => {
        expect(getPermissionKeyForTool('run_command')).toBe('bash');
        expect(getPermissionKeyForTool('write_file')).toBe('edit');
        expect(getPermissionKeyForTool('search_code')).toBe('grep');
    });

    it('maps LSP tools to the shared lsp permission key', () => {
        expect(getPermissionKeyForTool('lsp_definition')).toBe('lsp');
    });

    it('normalizes invalid permission modes back to ask', () => {
        expect(normalizePermissionMode('allow')).toBe('allow');
        expect(normalizePermissionMode('invalid')).toBe('ask');
        expect(normalizePermissionMode(undefined)).toBe('ask');
    });

    it('resolves tool permissions from shared permission keys', () => {
        expect(resolveToolPermissionMode('run_command', {
            defaultMode: 'deny',
            tools: { bash: 'allow' },
        })).toBe('allow');
        expect(resolveToolPermissionMode('lsp_definition', {
            defaultMode: 'deny',
            tools: { lsp: 'allow' },
        })).toBe('allow');
        expect(resolveToolPermissionMode('unknown_tool', {
            defaultMode: 'ask',
            tools: {},
        })).toBe('ask');
        expect(resolveToolPermissionMode('read_file', undefined)).toBe('ask');
    });
});
