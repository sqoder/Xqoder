import type { LLMMessage } from '@xqoder/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectMvpContext } from './context-collector.js';
import { shapeMvpContext } from './context-shaper.js';
import { MvpRuntimeController, type MvpRuntimeControllerOptions } from './orchestrator.js';
import { planMvpTurn, renderMvpPlannerPrompt } from './planner.js';
import { loadMvpRuntimeConfig } from './runtime-config.js';
import type { AgentRuntimeProfile, MvpTaskType } from './types.js';
import { parseGitHubRepositoryUrl } from '../github-repo-url.js';
import type { ConversationForcedStopDirective } from '../../../application/chat/conversation-engine.js';
import type { AgentSession } from '../session/session.js';

const DIRECTORY_KEY_FILE_BLOCKER_MARKER = 'Directory project analysis key-file follow-up required.';
const KEY_FILE_CANDIDATE_LIMIT = 6;
type DirectoryEvidenceCategory = 'overview' | 'source' | 'documentation' | 'project';
type MissingDirectoryEvidenceCategory =
    | DirectoryEvidenceCategory
    | 'second_source'
    | 'documentation_or_project'
    | 'source_or_documentation';
interface DirectoryKeyFileCandidate {
    path: string;
    category: DirectoryEvidenceCategory;
}

const DIRECT_KEY_FILE_CANDIDATES = [
    { relativePath: 'README.md', category: 'overview' },
    { relativePath: 'README.MD', category: 'overview' },
    { relativePath: 'readme.md', category: 'overview' },
    { relativePath: 'Package.swift', category: 'overview' },
    { relativePath: 'package.json', category: 'overview' },
    { relativePath: 'pnpm-workspace.yaml', category: 'overview' },
    { relativePath: 'bun.lock', category: 'overview' },
    { relativePath: 'firebase.json', category: 'overview' },
    { relativePath: 'firestore.rules', category: 'overview' },
    { relativePath: 'metadata.json', category: 'overview' },
    { relativePath: 'index.html', category: 'overview' },
    { relativePath: 'Project.swift', category: 'overview' },
    { relativePath: 'pyproject.toml', category: 'overview' },
    { relativePath: 'Cargo.toml', category: 'overview' },
    { relativePath: 'go.mod', category: 'overview' },
    { relativePath: 'pubspec.yaml', category: 'overview' },
    { relativePath: 'pom.xml', category: 'overview' },
    { relativePath: 'build.gradle', category: 'overview' },
    { relativePath: 'settings.gradle', category: 'overview' },
    { relativePath: 'Podfile', category: 'overview' },
    { relativePath: 'Today3/App/RootView.swift', category: 'source' },
    { relativePath: 'Sources/Today3Core/Services/PlannerEngine.swift', category: 'source' },
    { relativePath: 'Sources/Today3Core/Services/PlannerContext.swift', category: 'source' },
    { relativePath: 'Sources/Today3Core/PlannerEngine.swift', category: 'source' },
] satisfies Array<{ relativePath: string; category: DirectoryEvidenceCategory }>;
const DIRECTORY_SCAN_SKIP_NAMES = new Set([
    '.git',
    '.next',
    '.turbo',
    '.venv',
    'DerivedData',
    'build',
    'coverage',
    'dist',
    'node_modules',
]);

export interface MvpConversationRuntimeOptions extends MvpRuntimeControllerOptions {
    runtimeProfile?: AgentRuntimeProfile;
}

export interface MvpConversationRuntime {
    prepareMessages(): LLMMessage[];
    runPostToolVerification(): Promise<void>;
    getForcedStopDirective(): ConversationForcedStopDirective | undefined;
    getForcedStopMessage(): string | undefined;
    getCompletionBlocker(): string | undefined;
    getNoToolCompletionBlocker(toolExecutedInCurrentRun: boolean): string | undefined;
    shouldDeferAssistantOutput(toolExecutedInCurrentRun: boolean): boolean;
    finalizeAssistantResponse(content: string): string;
}

export function createMvpConversationRuntime(
    options: MvpConversationRuntimeOptions,
): MvpConversationRuntime {
    const runtimeConfig = options.runtimeConfig ?? loadMvpRuntimeConfig(options.projectRoot);
    const controller = new MvpRuntimeController({
        ...options,
        runtimeConfig,
    });
    let latestTaskType: MvpTaskType = 'question';
    let latestRequiresToolEvidence = false;
    let latestTargetPaths: string[] = [];
    let latestTargetUrls: string[] = [];

    return {
        prepareMessages(): LLMMessage[] {
            const context = collectMvpContext({
                userGoal: options.userGoal,
                projectRoot: options.projectRoot,
                contextPaths: options.contextPaths,
                session: options.session,
            });
            latestTaskType = context.taskType;
            latestRequiresToolEvidence = context.targetPaths.length > 0 || context.targetUrls.length > 0;
            latestTargetPaths = context.targetPaths;
            latestTargetUrls = context.targetUrls;
            controller.beginTurn(latestTaskType);

            const shaped = shapeMvpContext(context);
            const plan = planMvpTurn({
                context,
                hasBlockingVerification: Boolean(controller.getCompletionBlocker()),
                hasPendingWrites: controller.hasPendingSuccessfulWrites(),
                runtimeProfile: options.runtimeProfile,
            });

            return [
                ...options.session.getMessages(),
                {
                    role: 'system',
                    content: renderMvpPlannerPrompt(shaped, plan),
                },
            ];
        },
        runPostToolVerification(): Promise<void> {
            return controller.runPostToolVerification();
        },
        getForcedStopDirective(): ConversationForcedStopDirective | undefined {
            if (runtimeConfig.stopConditions.timeoutMs !== undefined) {
                const elapsed = Date.now() - controller.getStartedAtMs();
                if (elapsed > runtimeConfig.stopConditions.timeoutMs) {
                    return {
                        stopReason: 'max_wall_time',
                        message: `⏹ 停止：timeout（已运行 ${controller.getLoopCount()} 轮）`,
                    };
                }
            }

            if (controller.getLoopCount() > runtimeConfig.stopConditions.maxLoops) {
                return {
                    stopReason: 'max_turns',
                    message: `⏹ 停止：max_loops（已运行 ${controller.getLoopCount() - 1} 轮）`,
                };
            }

            return undefined;
        },
        getForcedStopMessage(): string | undefined {
            return this.getForcedStopDirective()?.message;
        },
        getCompletionBlocker(): string | undefined {
            return controller.getCompletionBlocker();
        },
        getNoToolCompletionBlocker(toolExecutedInCurrentRun: boolean): string | undefined {
            if (toolExecutedInCurrentRun) {
                if (latestTaskType === 'question' && latestRequiresToolEvidence) {
                    return getTargetAnalysisBlocker(options.session, {
                        targetPaths: latestTargetPaths,
                        targetUrls: latestTargetUrls,
                        projectRoot: options.projectRoot,
                    });
                }
                return undefined;
            }

            if (latestTaskType === 'question' && !latestRequiresToolEvidence) {
                return undefined;
            }

            return [
                'Do not finish yet.',
                'No tool activity was recorded in this run.',
                latestRequiresToolEvidence
                    ? latestTargetUrls.length > 0
                        ? 'The user named a concrete URL, so you must execute a real URL/network inspection tool before concluding.'
                        : 'The user named a concrete path, so you must execute real tools against that path before concluding.'
                    : `Task type is ${latestTaskType}, so you must execute real tools before concluding.`,
                latestTargetUrls.length > 0
                    ? formatPreferredUrlInspectionCall(latestTargetUrls[0]!)
                    : 'Call one or more tools (search_code, read_file, write_file, run_shell), then continue the loop with real execution evidence.',
            ].join('\n');
        },
        shouldDeferAssistantOutput(toolExecutedInCurrentRun: boolean): boolean {
            if (!latestRequiresToolEvidence) {
                return false;
            }

            if (latestTaskType === 'question') {
                return true;
            }

            if (!toolExecutedInCurrentRun) {
                return true;
            }

            return false;
        },
        finalizeAssistantResponse(content: string): string {
            if (latestTaskType === 'question') {
                return content;
            }

            if (controller.isCompletionReady()) {
                return content.startsWith('✅ 完成')
                    ? content
                    : `✅ 完成\n${content}`;
            }

            return content;
        },
    };
}

function getTargetAnalysisBlocker(
    session: AgentSession,
    input: {
        targetPaths: string[];
        targetUrls: string[];
        projectRoot: string;
    },
): string | undefined {
    return getDirectoryAnalysisBlocker(session, input.targetPaths, input.projectRoot)
        ?? getLargeFileAnalysisBlocker(session.getToolHistory(), input.targetPaths)
        ?? getUrlAnalysisBlocker(session.getToolHistory(), input.targetUrls);
}

function getDirectoryAnalysisBlocker(
    session: AgentSession,
    targetPaths: string[],
    projectRoot: string,
): string | undefined {
    const toolHistory = session.getToolHistory();
    const directoryTargets = targetPaths.filter((targetPath) => isExistingDirectoryPath(targetPath));
    const directoryFailureIndex = findLastDirectoryReadFailureIndex(toolHistory, targetPaths);
    if (directoryFailureIndex === -1 && directoryTargets.length === 0) {
        return undefined;
    }

    const relevantHistory = directoryFailureIndex === -1
        ? toolHistory
        : toolHistory.slice(directoryFailureIndex + 1);
    const analysisTargets = directoryTargets.length > 0 ? directoryTargets : targetPaths;
    const hasDirectoryListingEvidence = relevantHistory
        .some((entry) => isDirectoryListingEvidence(entry, analysisTargets));
    const keyFileCandidates = analysisTargets
        .flatMap((analysisTarget) => findExistingKeyFileCandidates(analysisTarget, projectRoot))
        .filter((candidate, index, allCandidates) => (
            allCandidates.findIndex((otherCandidate) => otherCandidate.path === candidate.path) === index
        ))
        .slice(0, KEY_FILE_CANDIDATE_LIMIT);
    const evidenceState = getDirectoryProjectEvidenceState({
        toolHistory: relevantHistory,
        targetPaths: analysisTargets,
        projectRoot,
        keyFileCandidates,
    });
    if (hasDirectoryListingEvidence && evidenceState.satisfied) {
        return undefined;
    }

    const targetPath = analysisTargets[0] ?? 'the same directory';
    const firstAction = directoryFailureIndex === -1
        ? 'The user provided a directory path for project analysis.'
        : 'The user provided a directory path, but read_file was called on the directory and failed.';
    const nextCandidate = selectNextKeyFileCandidate(keyFileCandidates, evidenceState);
    const exactReadInstruction = keyFileCandidates.length > 0
        ? [
            'Next action must be a read_file tool call on a real key file inside the directory.',
            `Prefer this exact call: read_file {"path":"${nextCandidate?.path ?? keyFileCandidates[0]!.path}"}`,
            'Other acceptable key files:',
            ...keyFileCandidates
                .filter((candidate) => candidate.path !== nextCandidate?.path)
                .map((candidate) => `- ${candidate.path}`),
        ].filter(Boolean).join('\n')
        : 'Next action must be a read_file tool call for an overview, manifest, config, Docs, or source entry file inside that directory.';
    const nextAction = hasDirectoryListingEvidence
        ? [
            'A directory listing was inspected, but the project analysis evidence is still too shallow.',
            evidenceState.missingDescription,
            'Do not answer from the directory tree or a single manifest alone.',
        ].join(' ')
        : 'Call list_files or glob_files on that directory first, then read a real overview, manifest, config, Docs, or source entry file.';

    return [
        `Marker: ${DIRECTORY_KEY_FILE_BLOCKER_MARKER}`,
        `Target: ${targetPath}`,
        'Do not finish yet.',
        firstAction,
        `Before answering, inspect the directory project at ${targetPath}.`,
        nextAction,
        exactReadInstruction,
        'Do not ask the user to provide a specific file until this directory inspection has been attempted.',
    ].join('\n');
}

function findExistingKeyFileCandidates(targetPath: string, projectRoot: string): DirectoryKeyFileCandidate[] {
    const targetDirectory = resolveFilesystemPath(targetPath, projectRoot);
    if (!isExistingDirectoryPath(targetDirectory)) {
        return [];
    }

    const candidates: DirectoryKeyFileCandidate[] = [];
    const seen = new Set<string>();
    const addCandidate = (
        candidatePath: string | undefined,
        category: DirectoryEvidenceCategory | undefined,
    ) => {
        if (!candidatePath || seen.has(candidatePath)) {
            return;
        }
        try {
            if (fs.statSync(candidatePath).isFile()) {
                seen.add(candidatePath);
                candidates.push({
                    path: candidatePath,
                    category: category ?? classifyDirectoryKeyFilePath(candidatePath, targetDirectory),
                });
            }
        } catch {
            // Ignore stale or unreadable candidates; the model can still inspect another file.
        }
    };

    for (const candidate of DIRECT_KEY_FILE_CANDIDATES) {
        addCandidate(path.join(targetDirectory, candidate.relativePath), candidate.category);
    }

    addCandidate(findFirstMatchingFile(
        targetDirectory,
        (_candidatePath, relativePath) => /(^|\/)App\/RootView\.swift$/i.test(relativePath),
        4,
    ), 'source');
    addCandidate(findFirstMatchingFile(
        path.join(targetDirectory, 'Sources'),
        (candidatePath) => isCoreSourceFileName(path.basename(candidatePath)),
        3,
    ), 'source');
    addCandidate(findFirstMatchingFile(
        path.join(targetDirectory, 'Docs'),
        (_candidatePath, relativePath) => /\.md$/i.test(relativePath),
        2,
    ), 'documentation');
    addCandidate(findFirstMatchingFile(
        targetDirectory,
        (_candidatePath, relativePath) => /\.xcodeproj\/project\.pbxproj$/i.test(relativePath),
        2,
    ), 'project');
    addCandidate(findFirstMatchingFile(
        path.join(targetDirectory, 'Sources'),
        (_candidatePath, relativePath) => /\.(swift|ts|tsx|js|jsx|py|go|rs|kt|java)$/i.test(relativePath),
        3,
    ), 'source');

    return candidates;
}

function isCoreSourceFileName(fileName: string): boolean {
    return /(Planner|Engine|Reducer|Store|Controller|ViewModel|Service|UseCase|Plan|Task).*\.(swift|ts|tsx|js|jsx|py|go|rs|kt|java)$/i
        .test(fileName);
}

function getDirectoryProjectEvidenceState(input: {
    toolHistory: ReturnType<AgentSession['getToolHistory']>;
    targetPaths: string[];
    projectRoot: string;
    keyFileCandidates: DirectoryKeyFileCandidate[];
}): {
    satisfied: boolean;
    missingCategory: MissingDirectoryEvidenceCategory | undefined;
    missingDescription: string;
    readPaths: Set<string>;
} {
    const readPaths = new Set<string>();
    const readCategories = new Set<DirectoryEvidenceCategory>();
    const readCategoryCounts = new Map<DirectoryEvidenceCategory, number>();

    for (const entry of input.toolHistory) {
        if (
            entry.success
            && entry.name === 'read_file'
            && toolPathIsWithinTarget(entry.args['path'], input.targetPaths)
        ) {
            const readPath = normalizeComparablePath(String(entry.args['path']));
            if (readPaths.has(readPath)) {
                continue;
            }
            readPaths.add(readPath);
            const category = classifyReadFileEvidenceCategory(
                String(entry.args['path']),
                input.targetPaths,
                input.projectRoot,
            );
            readCategories.add(category);
            readCategoryCounts.set(category, (readCategoryCounts.get(category) ?? 0) + 1);
        }
    }

    if (input.keyFileCandidates.length === 0) {
        const hasAnyReadInsideDirectory = readPaths.size > 0;
        return {
            satisfied: hasAnyReadInsideDirectory,
            missingCategory: hasAnyReadInsideDirectory ? undefined : 'overview',
            missingDescription: hasAnyReadInsideDirectory
                ? 'A file inside the directory was read.'
                : 'No real file inside the directory has been read yet.',
            readPaths,
        };
    }

    const availableCategories = new Set(input.keyFileCandidates.map((candidate) => candidate.category));
    const availableSourceCount = input.keyFileCandidates.filter((candidate) => candidate.category === 'source').length;
    const availableDocumentationOrProject = input.keyFileCandidates.some((candidate) =>
        candidate.category === 'documentation' || candidate.category === 'project'
    );
    const readSourceCount = readCategoryCounts.get('source') ?? 0;
    const readDocumentationOrProjectCount = (readCategoryCounts.get('documentation') ?? 0)
        + (readCategoryCounts.get('project') ?? 0);

    if (availableCategories.has('overview') && !readCategories.has('overview')) {
        return {
            satisfied: false,
            missingCategory: 'overview',
            missingDescription: 'A manifest/overview/config file such as README, Package.swift, package.json, or project config is still missing.',
            readPaths,
        };
    }

    if (availableSourceCount > 0 && readSourceCount === 0) {
        return {
            satisfied: false,
            missingCategory: 'source',
            missingDescription: 'A source entry or core module is still missing after the overview file.',
            readPaths,
        };
    }

    if (availableSourceCount > 1 && readSourceCount < 2) {
        return {
            satisfied: false,
            missingCategory: 'second_source',
            missingDescription: 'Only one source file has been read; read another source/core module before summarizing the project.',
            readPaths,
        };
    }

    if (availableDocumentationOrProject && readDocumentationOrProjectCount === 0) {
        return {
            satisfied: false,
            missingCategory: 'documentation_or_project',
            missingDescription: 'A Docs file or project configuration file is still missing after the overview and source files.',
            readPaths,
        };
    }

    return {
        satisfied: readPaths.size > 0,
        missingCategory: readPaths.size > 0 ? undefined : 'overview',
        missingDescription: readPaths.size > 0
            ? 'Representative project files were read.'
            : 'No real key project file was read yet.',
        readPaths,
    };
}

function selectNextKeyFileCandidate(
    candidates: DirectoryKeyFileCandidate[],
    evidenceState: ReturnType<typeof getDirectoryProjectEvidenceState>,
): DirectoryKeyFileCandidate | undefined {
    const unreadCandidates = candidates.filter((candidate) =>
        !evidenceState.readPaths.has(normalizeComparablePath(candidate.path))
    );

    if (evidenceState.missingCategory === 'second_source') {
        return unreadCandidates.find((candidate) => candidate.category === 'source')
            ?? unreadCandidates[0];
    }

    if (evidenceState.missingCategory === 'documentation_or_project') {
        return unreadCandidates.find((candidate) => candidate.category === 'documentation')
            ?? unreadCandidates.find((candidate) => candidate.category === 'project')
            ?? unreadCandidates[0];
    }

    if (evidenceState.missingCategory === 'source_or_documentation') {
        return unreadCandidates.find((candidate) => candidate.category === 'source')
            ?? unreadCandidates.find((candidate) => candidate.category === 'documentation')
            ?? unreadCandidates.find((candidate) => candidate.category === 'project')
            ?? unreadCandidates[0];
    }

    if (evidenceState.missingCategory) {
        return unreadCandidates.find((candidate) => candidate.category === evidenceState.missingCategory)
            ?? unreadCandidates[0];
    }

    return unreadCandidates[0] ?? candidates[0];
}

function classifyReadFileEvidenceCategory(
    readPath: string,
    targetPaths: string[],
    projectRoot: string,
): DirectoryEvidenceCategory {
    const matchingTarget = targetPaths.find((targetPath) => {
        const normalizedTarget = normalizeComparablePath(resolveFilesystemPath(targetPath, projectRoot));
        const normalizedReadPath = normalizeComparablePath(readPath);
        const relative = path.relative(normalizedTarget, normalizedReadPath);
        return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    const targetDirectory = matchingTarget
        ? resolveFilesystemPath(matchingTarget, projectRoot)
        : projectRoot;

    return classifyDirectoryKeyFilePath(readPath, targetDirectory);
}

function classifyDirectoryKeyFilePath(
    candidatePath: string,
    targetDirectory: string,
): DirectoryEvidenceCategory {
    const relativePath = path.relative(targetDirectory, candidatePath).replace(/\\/g, '/');
    const basename = path.basename(relativePath).toLowerCase();

    if (relativePath.toLowerCase().includes('.xcodeproj/project.pbxproj')) {
        return 'project';
    }
    if (relativePath.toLowerCase().startsWith('docs/') || /(^|\/)docs\//i.test(relativePath)) {
        return 'documentation';
    }
    if (
        basename.startsWith('readme')
        || [
            'package.swift',
            'package.json',
            'pnpm-workspace.yaml',
            'bun.lock',
            'firebase.json',
            'firestore.rules',
            'metadata.json',
            'index.html',
            'project.swift',
            'pyproject.toml',
            'cargo.toml',
            'go.mod',
            'pubspec.yaml',
            'pom.xml',
            'build.gradle',
            'settings.gradle',
            'podfile',
        ].includes(basename)
    ) {
        return 'overview';
    }

    if (
        /\.(swift|ts|tsx|js|jsx|py|go|rs|kt|java)$/i.test(relativePath)
        || /(^|\/)(sources?|src|app|features?|services?)\//i.test(relativePath)
    ) {
        return 'source';
    }

    return 'overview';
}

function findFirstMatchingFile(
    rootDirectory: string,
    predicate: (candidatePath: string, relativePath: string) => boolean,
    maxDepth: number,
): string | undefined {
    if (!isExistingDirectoryPath(rootDirectory)) {
        return undefined;
    }

    const queue: Array<{ directoryPath: string; depth: number }> = [{
        directoryPath: rootDirectory,
        depth: 0,
    }];
    let inspectedEntries = 0;

    while (queue.length > 0 && inspectedEntries < 400) {
        const current = queue.shift()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current.directoryPath, { withFileTypes: true })
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch {
            continue;
        }

        for (const entry of entries) {
            inspectedEntries += 1;
            const candidatePath = path.join(current.directoryPath, entry.name);
            const relativePath = path.relative(rootDirectory, candidatePath);
            if (entry.isFile() && predicate(candidatePath, relativePath)) {
                return candidatePath;
            }
            if (
                entry.isDirectory()
                && current.depth < maxDepth
                && !DIRECTORY_SCAN_SKIP_NAMES.has(entry.name)
            ) {
                queue.push({
                    directoryPath: candidatePath,
                    depth: current.depth + 1,
                });
            }
        }
    }

    return undefined;
}

function resolveFilesystemPath(targetPath: string, projectRoot: string): string {
    return path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(projectRoot, targetPath);
}

function getLargeFileAnalysisBlocker(
    toolHistory: ReturnType<AgentSession['getToolHistory']>,
    targetPaths: string[],
): string | undefined {
    const largeFailureIndex = findLastLargeReadFailureIndex(toolHistory, targetPaths);
    if (largeFailureIndex === -1) {
        return undefined;
    }

    const evidenceAfterFailure = toolHistory
        .slice(largeFailureIndex + 1)
        .map((entry) => classifyLargeFileEvidenceForTarget(entry, targetPaths))
        .filter((entry): entry is LargeFileEvidenceKind => entry !== undefined);

    if (hasSufficientLargeFileEvidence(evidenceAfterFailure)) {
        return undefined;
    }

    const targetPath = targetPaths[0] ?? 'the same file';
    return [
        'Do not finish yet.',
        'A large file read failed and only a small first-range or insufficient evidence was inspected afterwards.',
        `Before answering, run one more targeted read-only tool on the same path (${targetPath}).`,
        'A title/meta-only search or lone tag match like <body> is not enough for project analysis.',
        'Prefer either read_file with a later range such as startLine=221/endLine=520, or search_code with structural patterns like <body, <script, id=, class=, function, const, screen, tab, modal.',
        'Then answer concisely in the user language and do not claim uninspected external files or dependencies.',
    ].join('\n');
}

function getUrlAnalysisBlocker(
    toolHistory: ReturnType<AgentSession['getToolHistory']>,
    targetUrls: string[],
): string | undefined {
    if (targetUrls.length === 0) {
        return undefined;
    }

    const targetUrl = targetUrls[0] ?? 'the same URL';
    const githubRepo = parseGitHubRepositoryUrl(targetUrl);
    if (githubRepo) {
        if (toolHistory.some((entry) => isCompleteGitHubRepoInspectionEvidence(entry, targetUrl))) {
            return undefined;
        }

        const hasReadmeOnlyEvidence = toolHistory.some((entry) => (
            entry.success
            && entry.name === 'fetch_url'
            && urlToolArgumentMatchesTarget(entry.args['url'], targetUrl)
        ));
        const hasIncompleteInspection = toolHistory.some((entry) => (
            entry.success
            && entry.name === 'inspect_github_repo'
            && urlToolArgumentMatchesTarget(entry.args['url'], targetUrl)
        ));
        const evidenceWarning = hasIncompleteInspection
            ? 'A GitHub repository inspection ran, but it did not contain complete structure + overview + source/config evidence.'
            : hasReadmeOnlyEvidence
            ? 'README/page fetch evidence is present, but README-only evidence is not enough for GitHub repository analysis.'
            : 'No GitHub repository inspection evidence has been recorded yet.';

        return [
            'Do not finish yet.',
            'The user provided a GitHub repository URL for analysis.',
            `Target repository: ${githubRepo.slug}`,
            evidenceWarning,
            'Before answering, inspect the repository structure plus at least one overview file and one source/config entry file.',
            formatPreferredUrlInspectionCall(targetUrl),
            'Do not answer from the README or GitHub page alone.',
        ].join('\n');
    }

    if (toolHistory.some((entry) => isUrlInspectionEvidence(entry, targetUrls))) {
        return undefined;
    }

    return [
        'Do not finish yet.',
        'The user provided an http(s) URL for analysis, but no URL/network inspection evidence has been recorded yet.',
        `Before answering, inspect the URL: ${targetUrl}.`,
        'Use fetched page/API evidence before summarizing the URL.',
        formatPreferredUrlInspectionCall(targetUrl),
        'Do not treat URL path segments as local filesystem paths.',
    ].join('\n');
}

type LargeFileEvidenceKind = 'first_range_read' | 'later_range_read' | 'rich_structural_search';

function isUrlInspectionEvidence(
    entry: ReturnType<AgentSession['getToolHistory']>[number],
    targetUrls: string[],
): boolean {
    if (!entry.success) {
        return false;
    }

    if (targetUrls.some((targetUrl) => parseGitHubRepositoryUrl(targetUrl))) {
        return targetUrls.some((targetUrl) => isCompleteGitHubRepoInspectionEvidence(entry, targetUrl));
    }

    if (entry.name === 'fetch_url') {
        return targetUrls.some((targetUrl) => urlToolArgumentMatchesTarget(entry.args['url'], targetUrl));
    }

    if (entry.name === 'websearch' || entry.name === 'sourcegraph') {
        return targetUrls.some((targetUrl) => textArgumentReferencesTarget(entry.args, targetUrl));
    }

    return false;
}

function isCompleteGitHubRepoInspectionEvidence(
    entry: ReturnType<AgentSession['getToolHistory']>[number],
    targetUrl: string,
): boolean {
    if (
        !entry.success
        || entry.name !== 'inspect_github_repo'
        || !urlToolArgumentMatchesTarget(entry.args['url'], targetUrl)
    ) {
        return false;
    }

    const output = String(entry.outputPreview ?? '').toLowerCase();
    return /(?:^|\n)\s*-\s*structure:\s*yes\b/.test(output)
        && /(?:^|\n)\s*-\s*overview:\s*yes\b/.test(output)
        && /(?:^|\n)\s*-\s*source\/config:\s*yes\b/.test(output);
}

function formatPreferredUrlInspectionCall(targetUrl: string): string {
    return parseGitHubRepositoryUrl(targetUrl)
        ? `Prefer this exact call: inspect_github_repo {"url":"${targetUrl}","maxFiles":80}`
        : `Prefer this exact call: fetch_url {"url":"${targetUrl}","format":"markdown"}`;
}

function urlToolArgumentMatchesTarget(value: unknown, targetUrl: string): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return false;
    }

    const normalizedValue = normalizeUrlForComparison(value);
    const normalizedTarget = normalizeUrlForComparison(targetUrl);
    if (!normalizedValue || !normalizedTarget) {
        return value.trim() === targetUrl.trim();
    }
    if (normalizedValue === normalizedTarget) {
        return true;
    }

    const targetRepo = parseGitHubRepositoryUrl(normalizedTarget);
    if (!targetRepo) {
        return false;
    }

    const valueRepo = parseGitHubRepositoryUrl(normalizedValue);
    if (valueRepo && valueRepo.owner === targetRepo.owner && valueRepo.repo === targetRepo.repo) {
        return true;
    }

    return normalizedValue.includes(`/repos/${targetRepo.owner}/${targetRepo.repo}`)
        || normalizedValue.includes(`/${targetRepo.owner}/${targetRepo.repo}/`);
}

function textArgumentReferencesTarget(args: Record<string, unknown>, targetUrl: string): boolean {
    const combined = Object.values(args)
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    if (!combined) {
        return false;
    }

    const normalizedTarget = normalizeUrlForComparison(targetUrl);
    if (normalizedTarget && combined.includes(normalizedTarget.toLowerCase())) {
        return true;
    }

    const githubRepo = parseGitHubRepositoryUrl(targetUrl);
    return githubRepo
        ? combined.includes(`${githubRepo.owner}/${githubRepo.repo}`)
            || combined.includes(`github.com/${githubRepo.owner}/${githubRepo.repo}`)
        : false;
}

function normalizeUrlForComparison(value: string): string | undefined {
    try {
        const parsed = new URL(value.trim());
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return undefined;
    }
}

function findLastLargeReadFailureIndex(
    toolHistory: ReturnType<AgentSession['getToolHistory']>,
    targetPaths: string[],
): number {
    for (let index = toolHistory.length - 1; index >= 0; index -= 1) {
        const entry = toolHistory[index]!;
        if (
            entry.name === 'read_file'
            && !entry.success
            && entry.error?.includes('File is too large to read fully')
            && toolPathMatchesTarget(entry.args['path'], targetPaths)
        ) {
            return index;
        }
    }
    return -1;
}

function findLastDirectoryReadFailureIndex(
    toolHistory: ReturnType<AgentSession['getToolHistory']>,
    targetPaths: string[],
): number {
    for (let index = toolHistory.length - 1; index >= 0; index -= 1) {
        const entry = toolHistory[index]!;
        if (
            entry.name === 'read_file'
            && !entry.success
            && isDirectoryReadError(entry.error)
            && toolPathMatchesTarget(entry.args['path'], targetPaths)
        ) {
            return index;
        }
    }
    return -1;
}

function isDirectoryReadError(error: string | undefined): boolean {
    const normalized = String(error ?? '').toLowerCase();
    return normalized.includes('eisdir')
        || normalized.includes('illegal operation on a directory')
        || normalized.includes('path is a directory');
}

function isDirectoryListingEvidence(
    entry: ReturnType<AgentSession['getToolHistory']>[number],
    targetPaths: string[],
): boolean {
    if (!entry.success) {
        return false;
    }

    if (
        (entry.name === 'list_files' || entry.name === 'glob_files' || entry.name === 'search_code' || entry.name === 'grep_content')
        && toolPathMatchesTarget(entry.args['path'], targetPaths)
    ) {
        return true;
    }

    return false;
}

function isExistingDirectoryPath(value: string): boolean {
    try {
        return fs.existsSync(value) && fs.statSync(value).isDirectory();
    } catch {
        return false;
    }
}

function classifyLargeFileEvidenceForTarget(
    entry: ReturnType<AgentSession['getToolHistory']>[number],
    targetPaths: string[],
): LargeFileEvidenceKind | undefined {
    if (!entry.success || !toolPathMatchesTarget(entry.args['path'], targetPaths)) {
        return undefined;
    }

    if (entry.name === 'read_file') {
        return classifyReadFileRangeEvidence(entry.args);
    }

    if (entry.name === 'search_code') {
        const pattern = String(entry.args['pattern'] ?? '').toLowerCase();
        if (
            isGenericProjectSearchPattern(pattern)
            || isNoSearchResult(entry.outputPreview)
            || entry.outputPreview.includes('this was a generic search against a single file')
        ) {
            return undefined;
        }
        if (
            isRichStructuralSearchPattern(pattern)
            && hasMeaningfulStructuralSearchOutput(entry.outputPreview)
        ) {
            return 'rich_structural_search';
        }
        if (isTrivialHtmlMetadataPattern(pattern)) {
            return undefined;
        }
    }

    return undefined;
}

function hasSufficientLargeFileEvidence(evidenceKinds: LargeFileEvidenceKind[]): boolean {
    const hasFirstRange = evidenceKinds.includes('first_range_read');
    const hasLaterRange = evidenceKinds.includes('later_range_read');
    const hasRichStructuralSearch = evidenceKinds.includes('rich_structural_search');

    return hasLaterRange || (hasFirstRange && hasRichStructuralSearch);
}

function classifyReadFileRangeEvidence(args: Record<string, unknown>): LargeFileEvidenceKind | undefined {
    if (args['startLine'] === undefined && args['endLine'] === undefined) {
        return undefined;
    }

    const startLine = readPositiveNumber(args['startLine']) ?? 1;
    const endLine = readPositiveNumber(args['endLine']);
    if (startLine > 1 || (endLine !== undefined && endLine > 260)) {
        return 'later_range_read';
    }

    return 'first_range_read';
}

function readPositiveNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

function toolPathMatchesTarget(value: unknown, targetPaths: string[]): boolean {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return false;
    }
    if (targetPaths.length === 0) {
        return true;
    }

    const normalizedValue = normalizeComparablePath(value);
    return targetPaths.some((targetPath) => normalizedValue === normalizeComparablePath(targetPath));
}

function toolPathIsWithinTarget(value: unknown, targetPaths: string[]): boolean {
    if (typeof value !== 'string' || value.trim().length === 0 || targetPaths.length === 0) {
        return false;
    }

    const normalizedValue = normalizeComparablePath(value);
    return targetPaths.some((targetPath) => {
        const normalizedTarget = normalizeComparablePath(targetPath);
        const relative = path.relative(normalizedTarget, normalizedValue);
        return Boolean(relative)
            && !relative.startsWith('..')
            && !path.isAbsolute(relative);
    });
}

function normalizeComparablePath(value: string): string {
    return path.normalize(value.trim());
}

function isGenericProjectSearchPattern(pattern: string): boolean {
    const normalized = pattern.replace(/[^a-z0-9]+/g, ' ').trim();
    return [
        'project overview',
        'project description',
        'project details',
        'project structure',
        'project summary',
    ].some((genericPattern) => normalized.includes(genericPattern));
}

function isNoSearchResult(outputPreview: string): boolean {
    const normalized = outputPreview.toLowerCase();
    return normalized.includes('no matching results')
        || normalized.includes('no matches')
        || normalized.includes('0 results');
}

function isRichStructuralSearchPattern(pattern: string): boolean {
    const normalized = pattern.toLowerCase();
    return [
        '<body',
        '<style',
        '<script',
        '</script',
        '<main',
        '<section',
        '<template',
        'function',
        'const',
        'let',
        'class=',
        'id=',
        'onclick',
        'screen',
        'tab',
        'panel',
        'modal',
        'navigate',
        'switch',
        'push',
    ].some((needle) => normalized.includes(needle));
}

function hasMeaningfulStructuralSearchOutput(outputPreview: string): boolean {
    const lines = outputPreview
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) {
        return false;
    }

    const combinedOutput = lines.join('\n').toLowerCase();
    if (hasHighValueStructuralSignal(combinedOutput)) {
        return true;
    }

    const nonBareTagLines = lines.filter((line) => !isBareHtmlTagSearchLine(line));
    return nonBareTagLines.length >= 2;
}

function hasHighValueStructuralSignal(value: string): boolean {
    return [
        'function',
        'const',
        'let',
        'class=',
        'id=',
        'onclick',
        'screen',
        'tab',
        'panel',
        'modal',
        'navigate',
        'switch',
        'push',
    ].some((needle) => value.includes(needle));
}

function isBareHtmlTagSearchLine(line: string): boolean {
    const withoutLineNumber = line.replace(/^\d+[:-]\s*/, '').trim();
    return /^<\/?(?:body|script|style|main|section|template)\b[^>]*>\s*$/i.test(withoutLineNumber);
}

function isTrivialHtmlMetadataPattern(pattern: string): boolean {
    const normalized = pattern.replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.length === 0) {
        return true;
    }

    return [
        'title',
        'meta',
        'charset',
        'viewport',
        'doctype',
        'html lang',
        'head',
        'font',
        'stylesheet',
    ].some((metadataPattern) => normalized === metadataPattern || normalized.includes(metadataPattern));
}
