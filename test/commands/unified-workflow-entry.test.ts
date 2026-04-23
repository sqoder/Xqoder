import { describe, expect, it } from 'bun:test';
import { createPlanCommand, createReviewCommand } from '../../src/commands/workflows/unified-entry.js';

describe('unified workflow entry commands', () => {
    it('routes xqoder plan through the shared slash-command path', async () => {
        const received: { prompt?: string; agent?: string } = {};
        const command = createPlanCommand({
            createSessionStore: () => ({
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'plan-summary' }),
            }),
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4.1',
                        apiKey: 'test-key',
                    },
                    providers: {
                        openai: {
                            apiKey: 'test-key',
                            defaultModel: 'gpt-4.1',
                        },
                    },
                    defaultAgent: 'general',
                    agents: {
                        general: {
                            mode: 'primary',
                            provider: 'openai',
                            model: 'gpt-4.1',
                        },
                    },
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                }),
            },
            agentFactory: (config) => {
                received.agent = String(config.agentName ?? '');
                return {
                    async run(prompt: string) {
                        received.prompt = prompt;
                        return 'plan reply';
                    },
                    getSession() {
                        return { id: 'agent-session' };
                    },
                    async dispose() {},
                };
            },
        });

        await command.parseAsync(['node', 'plan', 'stabilize conversation engine'], { from: 'node' });

        expect(received.agent).toBe('plan');
        expect(received.prompt).toContain('Mode: PLAN');
        expect(received.prompt).toContain('User request: stabilize conversation engine');
    });

    it('routes xqoder review through the shared slash-command path', async () => {
        const received: { prompt?: string; agent?: string } = {};
        const command = createReviewCommand({
            createSessionStore: () => ({
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'review-summary' }),
            }),
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4.1',
                        apiKey: 'test-key',
                    },
                    providers: {
                        openai: {
                            apiKey: 'test-key',
                            defaultModel: 'gpt-4.1',
                        },
                    },
                    defaultAgent: 'general',
                    agents: {
                        general: {
                            mode: 'primary',
                            provider: 'openai',
                            model: 'gpt-4.1',
                        },
                    },
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                }),
            },
            agentFactory: (config) => {
                received.agent = String(config.agentName ?? '');
                return {
                    async run(prompt: string) {
                        received.prompt = prompt;
                        return 'review reply';
                    },
                    getSession() {
                        return { id: 'agent-session' };
                    },
                    async dispose() {},
                };
            },
        });

        await command.parseAsync(['node', 'review', 'src/application/chat'], { from: 'node' });

        expect(received.agent).toBe('coder');
        expect(received.prompt).toContain('Mode: REVIEW');
        expect(received.prompt).toContain('User request: src/application/chat');
    });
});
