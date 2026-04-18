import { describe, expect, it } from 'bun:test';
import {
    getPermissionKeyForTool,
    resolveToolPermissionMode,
} from '../src/domain/permissions/index.js';

describe('domain tool permission policy', () => {
    it('maps tool names to stable permission keys', () => {
        expect(getPermissionKeyForTool('read_file')).toBe('read');
        expect(getPermissionKeyForTool('write_file')).toBe('edit');
        expect(getPermissionKeyForTool('run_command')).toBe('bash');
        expect(getPermissionKeyForTool('lsp_hover')).toBe('lsp');
        expect(getPermissionKeyForTool('custom_tool')).toBe('custom_tool');
    });

    it('resolves effective tool permission mode from config', () => {
        expect(resolveToolPermissionMode('write_file', undefined)).toBe('ask');
        expect(resolveToolPermissionMode('write_file', {
            defaultMode: 'deny',
            tools: {},
        })).toBe('deny');
        expect(resolveToolPermissionMode('write_file', {
            defaultMode: 'deny',
            tools: { edit: 'allow' },
        })).toBe('allow');
        expect(resolveToolPermissionMode('lsp_hover', {
            defaultMode: 'deny',
            tools: { lsp: 'ask' },
        })).toBe('ask');
    });
});
