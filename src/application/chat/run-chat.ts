import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    ConfigManager,
    configManager,
    resolveConfigWithEnvOverrides,
    formatOutput,
    createSpinner,
    type MessageAttachment,
    type OutputFormat,
    type SandboxSettings,
} from '@xqoder/shared';
import {
    AgentSession,
    XQoderAgent,
    buildAgentConfigFromXQoderConfig,
    type AgentCallbacks,
} from '@xqoder/agent';
import { MISSING_API_KEY_GUIDANCE } from '../config/api-key-guidance.js';
import { buildProjectNotepadPromptAppendix } from '../system/notepad.js';
import type {
    ChatAgentFactoryConfig,
    ChatAgentInstance,
    ChatSessionStore,
} from './ports.js';

export interface ChatRunOptions {
    dir: string;
    model?: string;
    agent?: string;
    session?: string;
    newSession?: boolean;
    format?: OutputFormat;
    attachments?: MessageAttachment[];
}

export interface ChatServiceDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    sessionStore?: ChatSessionStore;
    createSessionStore?: () => ChatSessionStore | undefined;
    agentFactory?: (config: ChatAgentFactoryConfig) => ChatAgentInstance;
}

export interface NonInteractivePromptOptions {
    prompt: string;
    cwd: string;
    outputFormat: OutputFormat;
    quiet: boolean;
    model?: string;
    agent?: string;
}

const PROJECT_EXPLANATION_TRIGGER = /(?:this project|this repo|current project|current repo|workspace|codebase|这个项目|当前项目|这个仓库|当前仓库|这个代码库|当前代码库|解释.*项目|分析.*项目|解释.*仓库|分析.*仓库)/i;
const MAX_PROJECT_ENTRIES = 24;
const MAX_README_CHARS = 2400;

export function buildChatSystemPrompt(sandbox: SandboxSettings, cwd?: string): string {
    const permissionHint = sandbox.mode === 'full-access'
        ? 'You are currently in full-access mode, which allows reading and writing files anywhere on this machine. Only operate on files outside the project directory when the user explicitly requests it.'
        : sandbox.mode === 'paths'
            ? `You can currently access the project directory and these additional paths: ${sandbox.allowedPaths.length > 0 ? sandbox.allowedPaths.join(', ') : 'none'}.`
            : 'You can currently only access the project directory.';
    const notepadAppendix = cwd ? buildProjectNotepadPromptAppendix(cwd) : '';
    const projectHint = cwd
        ? `The current project directory is: ${cwd}.`
        : 'If a current project directory is available through runtime context, treat it as the default inspection target.';

    return `You are XQoder, an AI programming assistant working in the terminal.

How you work:
- ${permissionHint}
- ${projectHint}
- For greetings, small talk, or clarification questions, reply directly without proactively calling tools.
- For clear code tasks, read files, search code, execute commands, and modify files as needed.
- If the user asks about "this project", "this repo", "the current codebase", or requests an explanation of the current workspace, proactively inspect the repository yourself by using tools like list_files, read_file, grep_content, or search_code before asking the user for more files.
- Only ask the user to provide files or paths after you have already tried inspecting the current project and still lack enough information.
- If the user asks you to generate an entire project, fix, run, test, or deploy, you can give a brief judgment first; the terminal also provides stable workflow commands like /build /fix /run /test /deploy.
- If the user explicitly requests operations on paths outside the project directory (e.g., desktop), do not refuse outright or substitute with "project-internal alternatives"; instead, attempt the target path directly and trigger permission approval, letting the user decide whether to allow it.
- If the user expresses "you can operate the entire computer / give full access", prioritize triggering approval and wait for the user's decision.
- Keep replies concise, and prefer the user's language unless project instructions explicitly require another language.

Response format (very important, try to follow):
When answering coding-related questions, use the following 6-block structured output. Use the user's language unless project instructions require another language:

--------------------------------------------------
USER_PROMPT
Briefly restate or quote the user's question to help quickly recall context.

--------------------------------------------------
PLAN
List the steps you plan to take with numbers, for example:
1. Locate relevant files and functions
2. Read the current implementation to understand the issue
3. Modify or add code
4. Run relevant tests and summarize results

--------------------------------------------------
EXECUTION_LOG
Record the actions you actually performed here (which files were checked, which commands were run), in brief bullet points. Do not paste large code blocks.

--------------------------------------------------
RESULT
Summarize the key results of this operation in 1-3 lines, e.g., whether the issue was fixed, what risks were discovered, or conclusions.

--------------------------------------------------
FILE_CHANGES
When suggesting specific changes, provide Git-style diff code blocks per file ("FILE: path" + \`\`\`diff block).
If this does not involve code changes, explicitly state "No actual code changes this time, only design/notes."

--------------------------------------------------
NEXT_STEPS
Provide 1-3 suggested follow-up steps for the user (e.g., run tests, check a specific file, provide additional info).

When terminal width is limited, you can simplify the text appropriately, but still retain the 6 block titles in order.${notepadAppendix ? `\n\n${notepadAppendix}` : ''}`;
}

export function buildAutoProjectContext(cwd: string): string {
    const resolvedCwd = path.resolve(cwd);
    const sections: string[] = [`Project root: ${resolvedCwd}`];

    try {
        const entries = fs.readdirSync(resolvedCwd, { withFileTypes: true })
            .filter((entry) => !['.git', 'node_modules', 'dist', '.xqoder'].includes(entry.name))
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, MAX_PROJECT_ENTRIES)
            .map((entry) => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`);
        if (entries.length > 0) {
            sections.push(`Top-level entries:\n${entries.join('\n')}`);
        }
    } catch {
        // ignore directory scan failures and fall back to other context
    }

    const readmeSnippet = readSnippet(path.join(resolvedCwd, 'README.md'), MAX_README_CHARS);
    if (readmeSnippet) {
        sections.push(`README.md snippet:\n${readmeSnippet}`);
    }

    const packageJsonSummary = summarizePackageJson(path.join(resolvedCwd, 'package.json'));
    if (packageJsonSummary) {
        sections.push(`package.json summary:\n${packageJsonSummary}`);
    }

    for (const candidate of ['pyproject.toml', 'Cargo.toml', 'go.mod']) {
        const snippet = readSnippet(path.join(resolvedCwd, candidate), 1200);
        if (snippet) {
            sections.push(`${candidate} snippet:\n${snippet}`);
        }
    }

    return sections.join('\n\n');
}

export function maybeAugmentPromptWithProjectContext(prompt: string, cwd: string): string {
    if (!PROJECT_EXPLANATION_TRIGGER.test(prompt)) {
        return prompt;
    }

    const projectContext = buildAutoProjectContext(cwd);
    if (!projectContext.trim()) {
        return prompt;
    }

    return `${prompt}

[AutoProjectContext]
The following workspace context was gathered automatically because the user asked about the current project/repo. Use it directly instead of asking the user to provide the same files again unless the request still cannot be resolved.

${projectContext}
[/AutoProjectContext]`;
}

function resolveChatSession(
    sessionStore: Pick<ChatSessionStore, 'findLatestSession' | 'getSession'> | undefined,
    options: {
        projectRoot: string;
        sessionId?: string;
        newSession: boolean;
    },
): AgentSession | undefined {
    if (!sessionStore || options.newSession) {
        return undefined;
    }
    if (options.sessionId) {
        const explicitSession = sessionStore.getSession(options.sessionId);
        if (!explicitSession) {
            throw new Error(`Specified session not found: ${options.sessionId}`);
        }
        return explicitSession;
    }
    return sessionStore.findLatestSession(options.projectRoot) ?? undefined;
}

export async function runChatHeadless(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<{ response: string; sessionId: string }> {
    const resolvedDir = path.resolve(options.dir);
    const preparedPrompt = maybeAugmentPromptWithProjectContext(prompt, resolvedDir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? { mode: 'project', allowedPaths: [] };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    if (!sessionStore) {
        throw new Error('Session storage unavailable');
    }

    const session = resolveChatSession(sessionStore, {
        projectRoot: resolvedDir,
        sessionId: options.session,
        newSession: options.newSession ?? false,
    });
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: buildChatSystemPrompt(sandbox, resolvedDir),
        session,
    });

    if (!agentConfig.llmConfig.apiKey.trim()) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    let fullResponse = '';
    try {
        await agent.run(preparedPrompt, {
            onToken: (token: string) => { fullResponse += token; },
        }, options.attachments ?? []);
        const summary = sessionStore.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });
        return { response: fullResponse, sessionId: summary.id };
    } finally {
        await agent.dispose?.();
    }
}

export async function runChat(
    prompt: string,
    options: ChatRunOptions,
    dependencies: ChatServiceDependencies = {},
    callbacksFactory: () => AgentCallbacks,
): Promise<void> {
    const resolvedDir = path.resolve(options.dir);
    const preparedPrompt = maybeAugmentPromptWithProjectContext(prompt, resolvedDir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    const session = resolveChatSession(sessionStore, {
        projectRoot: resolvedDir,
        sessionId: options.session,
        newSession: options.newSession ?? false,
    });
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: buildChatSystemPrompt(sandbox, resolvedDir),
        session,
    });

    if (!dependencies.agentFactory && !agentConfig.llmConfig.apiKey.trim()) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const outputFormat: OutputFormat = options.format ?? 'text';
    const isJson = outputFormat === 'json';

    const spinner = isJson ? createSpinner('Thinking...') : null;
    try {
        let fullResponse = '';
        const callbacks = isJson
            ? { ...callbacksFactory(), onToken: (token: string) => { fullResponse += token; } }
            : callbacksFactory();

        await agent.run(preparedPrompt, callbacks, options.attachments ?? []);
        sessionStore?.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });

        spinner?.stop();
        if (isJson) {
            process.stdout.write(formatOutput(fullResponse, { format: 'json' }));
        }
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        await agent.dispose?.();
    }
}

export async function runNonInteractivePrompt(
    options: NonInteractivePromptOptions,
    dependencies: ChatServiceDependencies = {},
): Promise<void> {
    const resolvedDir = path.resolve(options.cwd);
    const preparedPrompt = maybeAugmentPromptWithProjectContext(options.prompt, resolvedDir);
    const loadedConfig = dependencies.configManager?.load({ cwd: resolvedDir }) ?? configManager.load({ cwd: resolvedDir });
    const { config: effectiveConfig } = resolveConfigWithEnvOverrides(loadedConfig);

    const sandbox = effectiveConfig.sandbox ?? {
        mode: 'project',
        allowedPaths: [],
    };
    const sessionStore = dependencies.sessionStore ?? dependencies.createSessionStore?.();
    const agentConfig = buildAgentConfigFromXQoderConfig(effectiveConfig, {
        agentName: options.agent,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        modelOverride: options.model,
        promptAppendix: buildChatSystemPrompt(sandbox, resolvedDir),
        sessionTitle: buildNonInteractiveTitle(options.prompt),
        autoApproveTools: true,
    });

    if (!dependencies.agentFactory && !agentConfig.llmConfig.apiKey.trim()) {
        throw new Error(MISSING_API_KEY_GUIDANCE);
    }

    const factoryConfig = {
        ...agentConfig,
        cwd: resolvedDir,
        projectRoot: resolvedDir,
        systemPrompt: agentConfig.systemPrompt ?? '',
        sandboxMode: agentConfig.sandboxMode ?? sandbox.mode,
        allowedPaths: agentConfig.allowedPaths ?? sandbox.allowedPaths,
        shell: agentConfig.shell,
        sessionTitle: agentConfig.sessionTitle,
        autoApproveTools: agentConfig.autoApproveTools,
    };
    const agent = dependencies.agentFactory?.(factoryConfig) ?? new XQoderAgent(agentConfig);

    const spinner = !options.quiet && options.outputFormat === 'text'
        ? createSpinner('Thinking...')
        : null;

    try {
        let fullResponse = '';
        await agent.run(preparedPrompt, {
            onToken: (token: string) => {
                fullResponse += token;
            },
        });

        sessionStore?.saveSession({
            session: agent.getSession(),
            projectRoot: resolvedDir,
            cwd: resolvedDir,
            model: agentConfig.llmConfig.model,
        });

        spinner?.stop();
        process.stdout.write(formatOutput(fullResponse, { format: options.outputFormat }));
        process.stdout.write('\n');
    } finally {
        spinner?.stop();
        await agent.dispose?.();
    }
}

function buildNonInteractiveTitle(prompt: string): string {
    const trimmedPrompt = prompt.trim();
    const titleSuffix = trimmedPrompt.length > 100
        ? `${trimmedPrompt.slice(0, 100)}...`
        : trimmedPrompt;

    return `Non-interactive: ${titleSuffix}`;
}

function readSnippet(filePath: string, maxChars: number): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) {
            return undefined;
        }
        return content.length > maxChars
            ? `${content.slice(0, maxChars)}...`
            : content;
    } catch {
        return undefined;
    }
}

function summarizePackageJson(filePath: string): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
            name?: string;
            version?: string;
            description?: string;
            scripts?: Record<string, string>;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const lines = [
            parsed.name ? `name=${parsed.name}` : undefined,
            parsed.version ? `version=${parsed.version}` : undefined,
            parsed.description ? `description=${parsed.description}` : undefined,
            parsed.scripts ? `scripts=${Object.keys(parsed.scripts).join(', ') || '-'}` : undefined,
            parsed.dependencies ? `dependencies=${Object.keys(parsed.dependencies).slice(0, 12).join(', ') || '-'}` : undefined,
            parsed.devDependencies ? `devDependencies=${Object.keys(parsed.devDependencies).slice(0, 12).join(', ') || '-'}` : undefined,
        ].filter((line): line is string => Boolean(line));

        return lines.length > 0 ? lines.join('\n') : undefined;
    } catch {
        return undefined;
    }
}
