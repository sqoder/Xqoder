import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { createMvpConversationRuntime } from '../../../src/core/agent/mvp/conversation-runtime.js';
import { extractCandidatePaths, extractTargetUrls } from '../../../src/core/agent/mvp/task-classifier.js';
import type { MvpRuntimeConfig } from '../../../src/core/agent/mvp/types.js';
import { parseGitHubRepositoryUrl } from '../../../src/core/agent/github-repo-url.js';

const createdPaths = new Set<string>();

afterEach(() => {
    for (const createdPath of createdPaths) {
        fs.rmSync(createdPath, { recursive: true, force: true });
    }
    createdPaths.clear();
});

describe('mvp conversation runtime adapter', () => {
    it('treats GitHub repository URLs as URLs rather than local path fragments', () => {
        const prompt = 'https://github.com/paoloanzn/free-code.git那帮我看下这个仓库呢';

        expect(extractTargetUrls(prompt)).toEqual(['https://github.com/paoloanzn/free-code.git']);
        expect(extractCandidatePaths(prompt)).toEqual([]);
    });

    it('parses GitHub repository URLs with git suffix, trailing paths, and case normalization', () => {
        expect(parseGitHubRepositoryUrl('https://github.com/PaoloAnzn/free-code.git')).toMatchObject({
            owner: 'paoloanzn',
            repo: 'free-code',
            slug: 'paoloanzn/free-code',
            normalizedUrl: 'https://github.com/paoloanzn/free-code.git',
        });
        expect(parseGitHubRepositoryUrl('https://github.com/paoloanzn/free-code/tree/main/src')).toMatchObject({
            owner: 'paoloanzn',
            repo: 'free-code',
        });
        expect(parseGitHubRepositoryUrl('https://gitlab.com/paoloanzn/free-code')).toBeUndefined();
        expect(parseGitHubRepositoryUrl('https://github.com/only-owner')).toBeUndefined();
    });

    it('builds planner prompts for question turns without forcing tool evidence', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-question-');
        const session = new AgentSession({ id: 'mvp-runtime-question', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: '你好',
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('Planner decision:');
        expect(plannerPrompt).toContain('- Task type: question');
        expect(plannerPrompt).toContain('- Preferred next action: answer');
        expect(runtime.getNoToolCompletionBlocker(false)).toBeUndefined();
        expect(runtime.finalizeAssistantResponse('你好，我在。')).toBe('你好，我在。');
    });

    it('requires structured GitHub repository evidence before answering repository analysis turns', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-url-question-');
        const session = new AgentSession({ id: 'mvp-runtime-url-question', systemPrompt: 'system' });
        const targetUrl = 'https://github.com/paoloanzn/free-code.git';
        const runtime = createMvpConversationRuntime({
            userGoal: `${targetUrl}那帮我看下这个仓库呢`,
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('- Preferred next action: inspect_github_repo');
        expect(plannerPrompt).toContain(`- ${targetUrl}`);
        expect(plannerPrompt).not.toContain('//github.com/paoloanzn/free-code.git (unknown)');
        expect(runtime.getNoToolCompletionBlocker(false)).toContain('concrete URL');
        expect(runtime.getNoToolCompletionBlocker(false)).toContain(`inspect_github_repo {"url":"${targetUrl}","maxFiles":80}`);
        expect(runtime.shouldDeferAssistantOutput(false)).toBe(true);

        session.recordToolExecution({
            id: 'fetch-repo',
            name: 'fetch_url',
            args: { url: targetUrl, format: 'markdown' },
            success: true,
            output: '# free-code\nREADME evidence',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('README-only evidence is not enough');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'inspect-repo-incomplete',
            name: 'inspect_github_repo',
            args: { url: targetUrl, maxFiles: 80 },
            success: true,
            output: [
                '# GitHub Repository Inspection',
                '## Evidence completeness',
                '- structure: yes (10 files discovered)',
                '- overview: yes (README.md)',
                '- source/config: no',
            ].join('\n'),
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('did not contain complete structure');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'inspect-repo',
            name: 'inspect_github_repo',
            args: { url: targetUrl, maxFiles: 80 },
            success: true,
            output: [
                '# GitHub Repository Inspection',
                '## Evidence completeness',
                '- structure: yes (120 files discovered)',
                '- overview: yes (README.md)',
                '- source/config: yes (package.json)',
                '## Key evidence files',
                '### package.json (config)',
                '### src/entrypoints/cli.tsx (source)',
            ].join('\n'),
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('keeps ordinary URL analysis on fetch_url evidence', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-ordinary-url-question-');
        const session = new AgentSession({ id: 'mvp-runtime-ordinary-url-question', systemPrompt: 'system' });
        const targetUrl = 'https://example.com/docs';
        const runtime = createMvpConversationRuntime({
            userGoal: `${targetUrl} 帮我看下这页写了什么`,
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('- Preferred next action: fetch_url');
        expect(runtime.getNoToolCompletionBlocker(false)).toContain(`fetch_url {"url":"${targetUrl}","format":"markdown"}`);

        session.recordToolExecution({
            id: 'fetch-page',
            name: 'fetch_url',
            args: { url: targetUrl, format: 'markdown' },
            success: true,
            output: '# Example page',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('requires real tool evidence before answering path-based question turns', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-path-question-');
        const session = new AgentSession({ id: 'mvp-runtime-path-question', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: '/Users/wangxinglin/Downloads/code.html 帮我分析一下这个项目',
            projectRoot,
            session,
            runtimeProfile: 'hybrid',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('- Task type: question');
        expect(plannerPrompt).toContain('- Preferred next action: read_file');
        expect(plannerPrompt).toContain('Answer in Chinese');
        expect(runtime.getNoToolCompletionBlocker(false)).toContain('The user named a concrete path');
        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(false)).toBe(true);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('treats concrete directory paths as projects to inspect before answering', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-dir-project-');
        fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'personal-blog' }));
        const session = new AgentSession({ id: 'mvp-runtime-dir-project', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: `${projectRoot}看一下这个项目呢`,
            projectRoot,
            session,
            runtimeProfile: 'hybrid',
            runtimeConfig: createRuntimeConfig(),
        });

        const messages = runtime.prepareMessages();
        const plannerPrompt = String(messages.at(-1)?.content ?? '');

        expect(plannerPrompt).toContain('- Preferred next action: list_files');
        expect(plannerPrompt).toContain(`${projectRoot} (directory)`);
        expect(plannerPrompt).toContain('do not call read_file on the directory itself');
        expect(runtime.getNoToolCompletionBlocker(false)).toContain('The user named a concrete path');

        session.recordToolExecution({
            id: 'read-directory',
            name: 'read_file',
            args: { path: projectRoot },
            success: false,
            output: '',
            error: `Path is a directory, not a file: ${projectRoot}. Use list_files or search_code on this directory.`,
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('directory path');
        expect(runtime.getNoToolCompletionBlocker(true)).toContain('list_files');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'list-directory',
            name: 'list_files',
            args: { path: projectRoot },
            success: true,
            output: 'package.json',
        });

        const keyFileBlocker = runtime.getNoToolCompletionBlocker(true);
        expect(keyFileBlocker).toContain('manifest/overview/config file');
        expect(keyFileBlocker).toContain(`read_file {"path":"${path.join(projectRoot, 'package.json')}"}`);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.addMessage({ role: 'system', content: keyFileBlocker ?? '' });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('manifest/overview/config file');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'read-package',
            name: 'read_file',
            args: { path: path.join(projectRoot, 'package.json') },
            success: true,
            output: '{"name":"personal-blog"}',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('requires overview, multiple source files, and docs when a directory project has them', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-dir-deep-project-');
        const rootViewPath = path.join(projectRoot, 'Today3', 'App', 'RootView.swift');
        const plannerPath = path.join(projectRoot, 'Sources', 'Today3Core', 'Services', 'PlannerEngine.swift');
        const docsPath = path.join(projectRoot, 'Docs', 'AppStoreMetadata.md');
        fs.mkdirSync(path.dirname(rootViewPath), { recursive: true });
        fs.mkdirSync(path.dirname(plannerPath), { recursive: true });
        fs.mkdirSync(path.dirname(docsPath), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, 'Package.swift'), '// swift package manifest');
        fs.writeFileSync(rootViewPath, 'struct RootView {}');
        fs.writeFileSync(plannerPath, 'public struct PlannerEngine {}');
        fs.writeFileSync(docsPath, '# App Store Metadata');
        const session = new AgentSession({ id: 'mvp-runtime-dir-deep-project', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: `${projectRoot} 分析一下这个项目是干嘛的`,
            projectRoot,
            session,
            runtimeProfile: 'hybrid',
            runtimeConfig: createRuntimeConfig(),
        });

        runtime.prepareMessages();
        session.recordToolExecution({
            id: 'list-directory',
            name: 'list_files',
            args: { path: projectRoot },
            success: true,
            output: [
                '- Package.swift',
                '- Today3/App/RootView.swift',
                '- Sources/Today3Core/Services/PlannerEngine.swift',
                '- Docs/AppStoreMetadata.md',
            ].join('\n'),
        });

        const firstBlocker = runtime.getNoToolCompletionBlocker(true);
        expect(firstBlocker).toContain(`read_file {"path":"${path.join(projectRoot, 'Package.swift')}"}`);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'read-package',
            name: 'read_file',
            args: { path: path.join(projectRoot, 'Package.swift') },
            success: true,
            output: '// swift package manifest',
        });

        const secondBlocker = runtime.getNoToolCompletionBlocker(true);
        expect(secondBlocker).toContain('source entry or core module');
        expect(secondBlocker).toContain(`read_file {"path":"${rootViewPath}"}`);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'read-root-view',
            name: 'read_file',
            args: { path: rootViewPath },
            success: true,
            output: 'struct RootView {}',
        });

        const thirdBlocker = runtime.getNoToolCompletionBlocker(true);
        expect(thirdBlocker).toContain('Only one source file has been read');
        expect(thirdBlocker).toContain(`read_file {"path":"${plannerPath}"}`);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'read-planner',
            name: 'read_file',
            args: { path: plannerPath },
            success: true,
            output: 'public struct PlannerEngine {}',
        });

        const fourthBlocker = runtime.getNoToolCompletionBlocker(true);
        expect(fourthBlocker).toContain('Docs file or project configuration file');
        expect(fourthBlocker).toContain(`read_file {"path":"${docsPath}"}`);
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'read-docs',
            name: 'read_file',
            args: { path: docsPath },
            success: true,
            output: '# App Store Metadata',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('keeps large file analysis open after only the first bounded range', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-large-file-');
        const targetPath = '/Users/wangxinglin/Downloads/code.html';
        const session = new AgentSession({ id: 'mvp-runtime-large-file', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: `${targetPath} 帮我分析一下这个项目`,
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        runtime.prepareMessages();
        session.recordToolExecution({
            id: 'read-large-full',
            name: 'read_file',
            args: { path: targetPath },
            success: false,
            output: '',
            error: 'File is too large to read fully (89756 bytes > 65536 bytes). Use startLine/endLine first.',
        });
        session.recordToolExecution({
            id: 'read-large-first-range',
            name: 'read_file',
            args: { path: targetPath, startLine: 1, endLine: 220 },
            success: true,
            output: '<!DOCTYPE html>\n<style>\n.phone { width: 393px; }\n',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('large file');
        expect(runtime.getNoToolCompletionBlocker(true)).toContain('read_file');
        expect(runtime.getNoToolCompletionBlocker(true)).toContain('search_code');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'search-title-only',
            name: 'search_code',
            args: { path: targetPath, pattern: '<title>' },
            success: true,
            output: '6:<title>Next 3 — 每天三步</title>',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('title');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'search-body-only',
            name: 'search_code',
            args: { path: targetPath, pattern: '<body' },
            success: true,
            output: '1657:<body>',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toContain('lone tag');
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);

        session.recordToolExecution({
            id: 'search-structural',
            name: 'search_code',
            args: { path: targetPath, pattern: '<script|<body|function|id=' },
            success: true,
            output: '1432:<body>\n1988:<script>\n1991:function navigateTo(screenId) {',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('unblocks large file analysis after reading a later bounded range', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-later-range-');
        const targetPath = '/Users/wangxinglin/Downloads/code.html';
        const session = new AgentSession({ id: 'mvp-runtime-later-range', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: `${targetPath} 看一下这个项目 用中文回答我`,
            projectRoot,
            session,
            runtimeProfile: 'mvp',
            runtimeConfig: createRuntimeConfig(),
        });

        runtime.prepareMessages();
        session.recordToolExecution({
            id: 'read-large-full',
            name: 'read_file',
            args: { path: targetPath },
            success: false,
            output: '',
            error: 'File is too large to read fully (89756 bytes > 65536 bytes). Use startLine/endLine first.',
        });
        session.recordToolExecution({
            id: 'read-large-first-range',
            name: 'read_file',
            args: { path: targetPath, startLine: 1, endLine: 220 },
            success: true,
            output: '<!DOCTYPE html>\n<title>Next 3 — 每天三步</title>\n<style>.phone { width: 393px; }</style>',
        });
        session.recordToolExecution({
            id: 'read-large-later-range',
            name: 'read_file',
            args: { path: targetPath, startLine: 221, endLine: 520 },
            success: true,
            output: '.tab-bar { display: flex; }\n.task-card { cursor: pointer; }\n',
        });

        expect(runtime.getNoToolCompletionBlocker(true)).toBeUndefined();
        expect(runtime.shouldDeferAssistantOutput(true)).toBe(true);
    });

    it('owns loop stop/tool-evidence policy outside the verification controller', () => {
        const projectRoot = createTempDir('xqoder-mvp-runtime-engineering-');
        const session = new AgentSession({ id: 'mvp-runtime-engineering', systemPrompt: 'system' });
        const runtime = createMvpConversationRuntime({
            userGoal: 'fix src/router.ts route bug',
            projectRoot,
            session,
            runtimeProfile: 'hybrid',
            runtimeConfig: createRuntimeConfig({
                stopConditions: {
                    hard: [],
                    soft: [],
                    maxLoops: 1,
                },
            }),
        });

        runtime.prepareMessages();
        expect(runtime.getNoToolCompletionBlocker(false)).toContain('No tool activity was recorded in this run.');
        expect(runtime.getForcedStopMessage()).toBeUndefined();

        runtime.prepareMessages();
        expect(runtime.getForcedStopMessage()).toContain('max_loops');
    });
});

function createRuntimeConfig(overrides: Partial<MvpRuntimeConfig> = {}): MvpRuntimeConfig {
    return {
        baselineCheck: false,
        distillVerifier: false,
        stopConditions: {
            hard: ['all_tests_pass'],
            soft: [],
            maxLoops: 4,
        },
        ...overrides,
    };
}

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    createdPaths.add(dir);
    return dir;
}
