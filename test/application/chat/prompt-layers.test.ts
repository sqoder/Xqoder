import { describe, expect, it } from 'bun:test';
import { buildBehaviorLayer } from '../../../src/application/chat/prompt-layers.js';
import {
    DEFAULT_MVP_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
} from '../../../src/core/agent/agent.js';
import { getBuiltInAgentDefinition } from '../../../src/core/agent/agents.js';

describe('prompt read permission guidance', () => {
    it('treats built-in read-only tools as direct inspection without confirmation', () => {
        const behavior = buildBehaviorLayer();

        expect(behavior).toContain(
            'Built-in read-only inspection tools (read_file, list_files, search_code, grep_content, glob_files, diagnostics, and LSP reads) can inspect user-requested paths directly without asking for confirmation first',
        );
        expect(behavior).toContain(
            'side-effectful operations on paths outside the project directory',
        );
        expect(behavior).toContain(
            'do not infer the purpose of a folder, the author\'s intent, or an alternative implementation path from names alone',
        );
        expect(behavior).not.toContain('prioritize triggering approval and wait');
    });

    it('tells directory analysis flows to avoid speculation from folder names alone', () => {
        const behavior = buildBehaviorLayer();

        expect(behavior).toContain(
            'Only state what inspected files or directory listings directly support',
        );
        expect(behavior).toContain(
            'say that the current evidence is insufficient instead of guessing',
        );
    });

    it('keeps default agent prompts aligned with read versus side-effect permission boundaries', () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            'Built-in read-only tools (read_file, list_files, search_code, grep_content, glob_files, diagnostics, and LSP read/navigation tools) may inspect user-requested paths directly',
        );
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            'Write, edit, shell, network, MCP, and other side-effectful operations remain governed by the permission system',
        );
        expect(DEFAULT_MVP_SYSTEM_PROMPT).toContain(
            'Built-in read/list/search tools can inspect concrete user-requested paths directly without asking for confirmation first',
        );
    });

    it('keeps built-in markdown agent prompts from asking before read-only inspection', () => {
        const general = getBuiltInAgentDefinition('general');
        const coder = getBuiltInAgentDefinition('coder');

        expect(general?.systemPrompt).toContain(
            'Built-in read-only tools can inspect concrete user-requested paths directly',
        );
        expect(coder?.systemPrompt).toContain(
            'Built-in read-only tools can inspect concrete user-requested paths directly',
        );
        expect(general?.systemPrompt).not.toContain('wait for user selection');
        expect(coder?.systemPrompt).not.toContain('trigger permission approval');
    });
});
