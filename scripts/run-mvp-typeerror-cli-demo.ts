import * as path from 'node:path';
import { createDefaultConfig } from '../src/infra/shared/config-defaults.js';
import { runRootShellAction } from '../src/cli/root-shell.js';
import { XQoderAgent } from '../src/core/agent/agent.js';
import {
    createMvpTypeErrorDemoProvider,
    createMvpTypeErrorDemoWorkspace,
    MVP_TYPEERROR_DEMO_PROMPT,
} from '../src/core/agent/mvp/demo.js';
import { FileRollbackStore } from '../src/core/agent/tools/rollback-store.js';

const workspaceDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : createMvpTypeErrorDemoWorkspace();

const baseConfig = createDefaultConfig(process.env);
const providerDefaults = baseConfig.providers?.openai ?? {
    apiKey: '',
    defaultModel: baseConfig.llm.model,
    disabled: false,
};

let savedSessionCount = 0;
await runRootShellAction({
    prompt: MVP_TYPEERROR_DEMO_PROMPT,
    cwd: workspaceDir,
    outputFormat: 'text',
    quiet: true,
}, {
    chatDependencies: {
        configManager: {
            load: () => ({
                ...baseConfig,
                llm: {
                    ...baseConfig.llm,
                    provider: 'openai',
                    model: 'mvp-demo-scripted',
                },
                providers: {
                    ...(baseConfig.providers ?? {}),
                    openai: {
                        ...providerDefaults,
                        apiKey: 'demo-key',
                        disabled: false,
                    },
                },
            }),
        },
        sessionStore: {
            findLatestSession: () => null,
            getSession: () => null,
            saveSession: () => {
                savedSessionCount += 1;
                return { id: `mvp-cli-demo-${savedSessionCount}` };
            },
        },
        agentFactory: (config) => {
            const provider = createMvpTypeErrorDemoProvider();
            return new XQoderAgent({
                ...(config as ConstructorParameters<typeof XQoderAgent>[0]),
                rollbackStore: new FileRollbackStore(path.join(workspaceDir, '.rollbacks')),
                providerFactory: async () => provider,
                permissions: {
                    defaultMode: 'allow',
                    tools: {},
                },
            });
        },
    },
});

console.log([
    'XQoder MVP CLI Demo',
    `Workspace: ${workspaceDir}`,
    `Saved sessions: ${savedSessionCount}`,
].join('\n'));
