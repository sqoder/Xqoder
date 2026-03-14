import { describe, expect, it } from 'vitest';
import { resolveRemoteToolPermissionMode } from './agent-service.js';

describe('remote tool permission mapping', () => {
    it('maps allow/ask/deny using tool aliases used by serve runtime', () => {
        expect(resolveRemoteToolPermissionMode('run_command', {
            defaultMode: 'deny',
            tools: { bash: 'allow' },
        })).toBe('allow');

        expect(resolveRemoteToolPermissionMode('websearch', {
            defaultMode: 'allow',
            tools: { websearch: 'ask' },
        })).toBe('ask');

        expect(resolveRemoteToolPermissionMode('write_file', {
            defaultMode: 'allow',
            tools: { edit: 'deny' },
        })).toBe('deny');
    });

    it('uses default mode and lsp alias fallback when no explicit tool override exists', () => {
        expect(resolveRemoteToolPermissionMode('lsp_definition', {
            defaultMode: 'ask',
            tools: { lsp: 'allow' },
        })).toBe('allow');

        expect(resolveRemoteToolPermissionMode('unknown_tool', {
            defaultMode: 'deny',
            tools: {},
        })).toBe('deny');

        expect(resolveRemoteToolPermissionMode('read_file', undefined)).toBe('ask');
    });
});
