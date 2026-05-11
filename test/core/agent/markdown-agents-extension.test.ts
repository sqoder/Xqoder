import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { listMarkdownAgents } from '../../../src/core/agent/markdown-agents.js';

let tempDir: string;
let userDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-p16a-md-'));
    userDir = path.join(tempDir, 'user-agents');
    fs.mkdirSync(userDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeAgent(fileName: string, content: string): void {
    fs.writeFileSync(path.join(userDir, fileName), content);
}

describe('markdown-agents frontmatter (P16a extension)', () => {
    it('parses provider/model/baseUrl/color fields', () => {
        writeAgent('my-explorer.md', [
            '---',
            'name: my-explorer',
            'mode: subagent',
            'provider: dashscope',
            'model: qwen-plus',
            'baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1',
            'color: cyan',
            'description: parallel explorer',
            '---',
            'System prompt body.',
            '',
        ].join('\n'));

        const agents = listMarkdownAgents({ cwd: tempDir, userAgentDir: userDir });
        const agent = agents.find((a) => a.name === 'my-explorer');
        expect(agent).toBeDefined();
        expect(agent?.provider).toBe('dashscope');
        expect(agent?.model).toBe('qwen-plus');
        expect(agent?.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
        expect(agent?.color).toBe('cyan');
    });

    it('accepts base_url snake_case alias', () => {
        writeAgent('alt.md', [
            '---',
            'name: alt',
            'mode: subagent',
            'base_url: https://example.com/api',
            '---',
            'System prompt.',
            '',
        ].join('\n'));
        const agents = listMarkdownAgents({ cwd: tempDir, userAgentDir: userDir });
        expect(agents.find((a) => a.name === 'alt')?.baseUrl).toBe('https://example.com/api');
    });

    it('leaves extension fields undefined when frontmatter omits them', () => {
        writeAgent('minimal.md', [
            '---',
            'name: minimal',
            'mode: subagent',
            '---',
            'System prompt.',
            '',
        ].join('\n'));
        const agent = listMarkdownAgents({ cwd: tempDir, userAgentDir: userDir }).find((a) => a.name === 'minimal');
        expect(agent?.provider).toBeUndefined();
        expect(agent?.baseUrl).toBeUndefined();
        expect(agent?.color).toBeUndefined();
    });
});
