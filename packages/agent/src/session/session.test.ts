import { describe, expect, it } from 'vitest';
import { AgentSession } from './session.js';

describe('AgentSession', () => {
    it('auto-compacts older messages and retains command/file history', () => {
        const session = new AgentSession({
            systemPrompt: 'system prompt',
            maxMessages: 6,
        });

        session.recordToolExecution({
            id: 'tool_cmd',
            name: 'run_command',
            args: {
                command: 'pnpm test',
            },
            success: true,
            output: 'tests passed',
            metadata: {
                command: 'pnpm test',
                cwd: '/workspace/demo',
            },
        });
        session.recordToolExecution({
            id: 'tool_write',
            name: 'write_file',
            args: {
                path: 'src/index.ts',
                content: 'console.log("hello")',
            },
            success: true,
            output: 'file written',
            metadata: {
                path: '/workspace/demo/src/index.ts',
                changeType: 'write',
                bytes: 20,
                existedBefore: false,
            },
        });

        session.addUserMessage('先看一下项目结构');
        session.addAssistantMessage({ role: 'assistant', content: '我先检查目录。' });
        session.addUserMessage('顺便运行测试');
        session.addAssistantMessage({ role: 'assistant', content: '我会跑一遍测试。' });
        session.addToolResult('tool_cmd', 'tests passed');
        session.addUserMessage('然后修一下入口文件');
        session.addAssistantMessage({ role: 'assistant', content: '已经修改入口文件。' });

        const messages = session.getMessages();
        const summaryMessage = messages.find((message) => (
            message.role === 'system' && message.content.startsWith('[XQoder auto-compact summary]')
        ));

        expect(session.getCompactions()).toHaveLength(1);
        expect(summaryMessage?.content).toContain('pnpm test');
        expect(summaryMessage?.content).toContain('src/index.ts');
        expect(session.getCommandHistory()).toHaveLength(1);
        expect(session.getFileChanges()).toHaveLength(1);
        expect(session.getToolHistory()).toHaveLength(2);
        expect(messages.length).toBeLessThanOrEqual(6);
    });

    it('records multi-file patch and restore history from tool metadata', () => {
        const session = new AgentSession({
            systemPrompt: 'system prompt',
        });

        session.recordToolExecution({
            id: 'tool_patch',
            name: 'apply_patch',
            args: {
                patch: 'diff --git a/src/index.ts b/src/index.ts',
            },
            success: true,
            output: 'patched',
            metadata: {
                filePaths: [
                    '/workspace/demo/src/index.ts',
                    '/workspace/demo/src/app.ts',
                ],
                changeType: 'patch',
            },
        });

        session.recordToolExecution({
            id: 'tool_restore',
            name: 'restore_rollback_point',
            args: {
                rollbackPointId: 'rollback_1',
            },
            success: true,
            output: 'restored',
            metadata: {
                filePaths: ['/workspace/demo/src/index.ts'],
                changeType: 'restore',
            },
        });

        expect(session.getFileChanges()).toMatchObject([
            {
                id: 'tool_patch',
                path: '/workspace/demo/src/index.ts',
                changeType: 'patch',
            },
            {
                id: 'tool_patch',
                path: '/workspace/demo/src/app.ts',
                changeType: 'patch',
            },
            {
                id: 'tool_restore',
                path: '/workspace/demo/src/index.ts',
                changeType: 'restore',
            },
        ]);
    });

    it('preserves session titles across snapshot restore', () => {
        const session = new AgentSession({
            title: 'Non-interactive: explain context usage',
            systemPrompt: 'system prompt',
        });

        session.addUserMessage('Explain the use of context in Go');
        const restored = AgentSession.fromSnapshot(session.toSnapshot());

        expect(restored.getTitle()).toBe('Non-interactive: explain context usage');

        restored.setTitle('Updated title');
        expect(restored.getTitle()).toBe('Updated title');
    });

    it('clones user message attachments when storing session messages', () => {
        const session = new AgentSession({ systemPrompt: 'system prompt' });
        const attachments = [{
            type: 'image' as const,
            mimeType: 'image/png',
            data: 'base64-data',
            filePath: '/tmp/demo.png',
            fileName: 'demo.png',
        }];

        session.addUserMessage('describe this image', attachments);
        attachments[0]!.data = 'mutated';

        const message = session.getMessages().find((entry) => entry.role === 'user');
        expect(message?.attachments).toEqual([{
            type: 'image',
            mimeType: 'image/png',
            data: 'base64-data',
            filePath: '/tmp/demo.png',
            fileName: 'demo.png',
        }]);
    });
});
