const MIN_DEDUPE_BLOCK_LENGTH = 80;
const MIN_RESTART_DISTANCE = 80;
const NEAR_DUPLICATE_THRESHOLD = 0.82;
const GITHUB_INSPECTION_OPENING_PATTERN = /我已经(?:检查|查看|看(?:过)?)了\s*GitHub(?:\s*仓库)?/giu;

export function removeRepeatedAssistantSections(content: string): string {
    if (content.length < MIN_DEDUPE_BLOCK_LENGTH * 2) {
        return trimRestartedAnswerTail(content);
    }

    const blocks = content.split(/\n{2,}/);
    const keptBlocks: string[] = [];
    const keptKeys: string[] = [];

    for (const block of blocks) {
        const key = normalizeResponseBlock(block);
        if (
            key.length >= MIN_DEDUPE_BLOCK_LENGTH
            && !containsCodeFence(block)
            && keptKeys.some((candidate) => candidate === key || areNearDuplicateBlocks(candidate, key))
        ) {
            continue;
        }

        keptBlocks.push(block);
        if (key.length >= MIN_DEDUPE_BLOCK_LENGTH && !containsCodeFence(block)) {
            keptKeys.push(key);
        }
    }

    return trimRestartedAnswerTail(keptBlocks.join('\n\n').trimEnd());
}

function normalizeResponseBlock(block: string): string {
    return block
        .toLowerCase()
        .replace(/[`*_#[\](){}<>|:：,，.。!！?？;；"'“”‘’\-—\s]/g, '')
        .trim();
}

function containsCodeFence(block: string): boolean {
    return block.includes('```');
}

function areNearDuplicateBlocks(left: string, right: string): boolean {
    return areSimilarNormalizedBlocks(left, right, NEAR_DUPLICATE_THRESHOLD);
}

function areSimilarNormalizedBlocks(
    left: string,
    right: string,
    threshold: number,
    minLength = MIN_DEDUPE_BLOCK_LENGTH,
    minLengthRatio = 0.72,
): boolean {
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    if (shorter < minLength || shorter / longer < minLengthRatio) {
        return false;
    }

    const leftShingles = createCharacterShingles(left);
    const rightShingles = createCharacterShingles(right);
    let intersection = 0;
    for (const shingle of leftShingles) {
        if (rightShingles.has(shingle)) {
            intersection += 1;
        }
    }
    const union = leftShingles.size + rightShingles.size - intersection;
    return union > 0 && intersection / union >= threshold;
}

function createCharacterShingles(value: string): Set<string> {
    const size = value.length < 140 ? 5 : 8;
    const shingles = new Set<string>();
    for (let index = 0; index <= value.length - size; index += 1) {
        shingles.add(value.slice(index, index + size));
    }
    if (shingles.size === 0 && value) {
        shingles.add(value);
    }
    return shingles;
}

function trimRestartedAnswerTail(content: string): string {
    const restartIndex = findRestartedAssistantAnswerIndex(content)
        ?? findTailOnlyPotentialRestartIndex(content);
    if (restartIndex === undefined) {
        return content;
    }

    return removeDanglingRestartLeadIn(content.slice(0, restartIndex)).trimEnd();
}

export function findRestartedAssistantAnswerIndex(content: string): number | undefined {
    const codeFenceRanges = findCodeFenceRanges(content);
    return findRestartedAnswerIndex(content, codeFenceRanges);
}

export function findPotentialRestartedAssistantAnswerIndex(content: string): number | undefined {
    const codeFenceRanges = findCodeFenceRanges(content);
    return findPotentialGitHubInspectionRestartIndex(content, codeFenceRanges)
        ?? findSubjectRestartIndex(content, codeFenceRanges, { requireSimilarWindow: false });
}

function findRestartedAnswerIndex(content: string, codeFenceRanges: TextRange[]): number | undefined {
    return findGenericBlockRestartIndex(content, codeFenceRanges)
        ?? findGitHubInspectionRestartIndex(content, codeFenceRanges)
        ?? findSubjectRestartIndex(content, codeFenceRanges, { requireSimilarWindow: true });
}

function findGenericBlockRestartIndex(content: string, codeFenceRanges: TextRange[]): number | undefined {
    // Detect generic large-block repetition or paragraph-level similarity loops
    const MIN_GENERIC_BLOCK = 150;
    const opening = content.slice(0, 1200);
    if (opening.length < MIN_GENERIC_BLOCK) {
        return undefined;
    }

    // 1. Exact block match (sliding window)
    for (let offset = 0; offset < opening.length - MIN_GENERIC_BLOCK; offset += 50) {
        const needle = opening.slice(offset, offset + MIN_GENERIC_BLOCK);
        const firstIdx = content.indexOf(needle);
        if (firstIdx === -1) continue;

        const nextIdx = content.indexOf(needle, firstIdx + MIN_RESTART_DISTANCE);
        if (nextIdx !== -1 && !isInsideRanges(nextIdx, codeFenceRanges)) {
            return nextIdx;
        }
    }

    // 2. Fuzzy paragraph match (catch rephrased repetitions)
    const blocks = content.split(/\n{2,}/);
    if (blocks.length > 6) {
        const openingBlocks = blocks.slice(0, 4).map(b => normalizeResponseBlock(b)).filter(b => b.length > 60);
        for (let i = 5; i < blocks.length; i++) {
            const currentBlock = normalizeResponseBlock(blocks[i]!);
            if (currentBlock.length < 60) continue;

            for (const openBlock of openingBlocks) {
                if (areSimilarNormalizedBlocks(openBlock, currentBlock, 0.70, 60)) {
                    // Found a paragraph that is very similar to an early paragraph
                    // Find where this block starts in the original content
                    const matchIdx = content.indexOf(blocks[i]!);
                    if (matchIdx !== -1 && matchIdx > 800) return matchIdx;
                }
            }
        }
    }

    return undefined;
}

function findGitHubInspectionRestartIndex(content: string, codeFenceRanges: TextRange[]): number | undefined {
    const opening = content.slice(0, 700);
    const openingMatch = opening.match(/我已经(?:检查|查看)了\s*GitHub\s*仓库\s*(https?:\/\/github\.com\/[^\s，,。)）]+)(?:\s*的内容)?/i);
    if (!openingMatch?.[1]) {
        return undefined;
    }

    const urlPattern = escapeRegExp(openingMatch[1]);
    const restartPattern = new RegExp(`我已经(?:检查|查看)了\\s*GitHub\\s*仓库\\s*${urlPattern}(?:\\s*的内容)?`, 'gi');
    const firstMatch = restartPattern.exec(content);
    if (!firstMatch) {
        return undefined;
    }

    for (let match = restartPattern.exec(content); match; match = restartPattern.exec(content)) {
        if (match.index < firstMatch.index + MIN_RESTART_DISTANCE || isInsideRanges(match.index, codeFenceRanges)) {
            continue;
        }

        return match.index;
    }

    return undefined;
}

function findPotentialGitHubInspectionRestartIndex(content: string, codeFenceRanges: TextRange[]): number | undefined {
    const firstMatch = findNextGitHubInspectionOpening(content);
    if (!firstMatch || firstMatch.index > 700 || isInsideRanges(firstMatch.index, codeFenceRanges)) {
        return undefined;
    }

    for (
        let match = findNextGitHubInspectionOpening(content, firstMatch.index + firstMatch.text.length);
        match;
        match = findNextGitHubInspectionOpening(content, match.index + match.text.length)
    ) {
        if (match.index < firstMatch.index + MIN_RESTART_DISTANCE || isInsideRanges(match.index, codeFenceRanges)) {
            continue;
        }

        return match.index;
    }

    return undefined;
}

function findTailOnlyPotentialRestartIndex(content: string): number | undefined {
    const codeFenceRanges = findCodeFenceRanges(content);
    const matches = findGitHubInspectionOpenings(content);
    if (matches.length < 2) {
        return undefined;
    }

    const [firstMatch, ...restMatches] = matches;
    if (!firstMatch) return undefined;

    for (const match of restMatches) {
        if (match.index < firstMatch.index + MIN_RESTART_DISTANCE || isInsideRanges(match.index, codeFenceRanges)) {
            continue;
        }

        const trailing = content.slice(match.index).trimStart();
        if (trailing.length <= 220) {
            return match.index;
        }
    }

    return undefined;
}

function findGitHubInspectionOpenings(content: string): Array<{ index: number; text: string }> {
    const openings: Array<{ index: number; text: string }> = [];
    for (
        let match = findNextGitHubInspectionOpening(content);
        match;
        match = findNextGitHubInspectionOpening(content, match.index + match.text.length)
    ) {
        openings.push(match);
    }

    return openings;
}

function findNextGitHubInspectionOpening(
    content: string,
    fromIndex = 0,
): { index: number; text: string } | undefined {
    GITHUB_INSPECTION_OPENING_PATTERN.lastIndex = fromIndex;
    const match = GITHUB_INSPECTION_OPENING_PATTERN.exec(content);
    if (!match) {
        return undefined;
    }

    return {
        index: match.index,
        text: match[0],
    };
}

function findSubjectRestartIndex(
    content: string,
    codeFenceRanges: TextRange[],
    options: { requireSimilarWindow: boolean },
): number | undefined {
    const openingSubject = extractOpeningSubject(content);
    if (!openingSubject) {
        return undefined;
    }

    const matchIndices = collectSubjectRestartMatchIndices(content, openingSubject, codeFenceRanges);
    if (matchIndices.length < 2) {
        return undefined;
    }

    const [firstMatchIndex, ...restartCandidates] = matchIndices;
    const openingWindow = normalizeResponseBlock(extractRestartComparisonWindow(content, firstMatchIndex));
    for (const restartIndex of restartCandidates) {
        if (restartIndex < firstMatchIndex + MIN_RESTART_DISTANCE || isInsideRanges(restartIndex, codeFenceRanges)) {
            continue;
        }

        if (!options.requireSimilarWindow) {
            return restartIndex;
        }

        if (hasRestartLeadInPrefix(content, restartIndex)) {
            return restartIndex;
        }

        const restartWindow = normalizeResponseBlock(extractRestartComparisonWindow(content, restartIndex));
        if (areSimilarNormalizedBlocks(openingWindow, restartWindow, 0.25, 20, 0.3)) {
            return restartIndex;
        }
    }

    return undefined;
}

function collectSubjectRestartMatchIndices(
    content: string,
    openingSubject: { value: string; backticked: boolean },
    codeFenceRanges: TextRange[],
): number[] {
    const indexSet = new Set<number>();
    const candidates = buildSubjectRestartCandidates(openingSubject.value);

    for (const candidate of candidates) {
        const restartPattern = createSubjectRestartPattern(candidate);
        for (let match = restartPattern.exec(content); match; match = restartPattern.exec(content)) {
            if (!isInsideRanges(match.index, codeFenceRanges)) {
                indexSet.add(match.index);
            }
        }
    }

    return [...indexSet].sort((left, right) => left - right);
}

function createSubjectRestartPattern(candidate: string): RegExp {
    const escaped = escapeRegExp(candidate);
    return new RegExp(`(?:\`${escaped}\`|${escaped})\\s*(?:是一个|是一款|是|为|属于)`, 'giu');
}

function buildSubjectRestartCandidates(subject: string): string[] {
    const candidates = new Set<string>();
    const normalizedSubject = normalizeSubjectCandidate(subject);
    addSubjectRestartCandidate(candidates, normalizedSubject);

    const withoutGitSuffix = normalizedSubject.replace(/\.git$/i, '');
    addSubjectRestartCandidate(candidates, withoutGitSuffix);

    const githubReference = parseGitHubReference(normalizedSubject);
    if (githubReference) {
        addSubjectRestartCandidate(candidates, `https://github.com/${githubReference.owner}/${githubReference.repo}`);
        addSubjectRestartCandidate(candidates, `https://github.com/${githubReference.owner}/${githubReference.repo}.git`);
        addSubjectRestartCandidate(candidates, `${githubReference.owner}/${githubReference.repo}`);
        addSubjectRestartCandidate(candidates, githubReference.repo);
    }

    const ownerRepoMatch = withoutGitSuffix.match(/^([A-Za-z0-9_.-]{1,80})\/([A-Za-z0-9_.-]{1,80})$/);
    if (ownerRepoMatch?.[1] && ownerRepoMatch[2]) {
        addSubjectRestartCandidate(candidates, ownerRepoMatch[0]);
        addSubjectRestartCandidate(candidates, ownerRepoMatch[2]);
    }

    return [...candidates];
}

function addSubjectRestartCandidate(candidates: Set<string>, candidate: string): void {
    const normalized = normalizeSubjectCandidate(candidate);
    if (normalized.length === 0 || normalized.length > 120) {
        return;
    }

    candidates.add(normalized);
}

function normalizeSubjectCandidate(subject: string): string {
    return subject
        .trim()
        .replace(/^`+|`+$/g, '')
        .replace(/[)\]}>》」』]+$/u, '')
        .replace(/[，,。.!！?？;；:：]+$/u, '')
        .trim();
}

function parseGitHubReference(subject: string): { owner: string; repo: string } | undefined {
    const normalized = normalizeSubjectCandidate(subject);
    const githubUrlMatch = normalized.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)(?:[/?#].*)?$/i);
    if (githubUrlMatch?.[1] && githubUrlMatch[2]) {
        const repo = githubUrlMatch[2].replace(/\.git$/i, '');
        if (repo.length > 0) {
            return { owner: githubUrlMatch[1], repo };
        }
    }

    return undefined;
}

interface TextRange {
    start: number;
    end: number;
}

function findCodeFenceRanges(content: string): TextRange[] {
    const ranges: TextRange[] = [];
    const fencePattern = /```/g;
    let openStart: number | undefined;
    for (let match = fencePattern.exec(content); match; match = fencePattern.exec(content)) {
        if (openStart === undefined) {
            openStart = match.index;
            continue;
        }

        ranges.push({ start: openStart, end: match.index + match[0].length });
        openStart = undefined;
    }

    if (openStart !== undefined) {
        ranges.push({ start: openStart, end: content.length });
    }

    return ranges;
}

function isInsideRanges(index: number, ranges: TextRange[]): boolean {
    return ranges.some((range) => index >= range.start && index < range.end);
}

function extractRestartComparisonWindow(content: string, startIndex: number): string {
    const slice = content.slice(startIndex, startIndex + 320);
    const endCandidates = [
        slice.search(/\n\s*\n/),
        findSentenceBoundary(slice),
    ].filter((index) => index > 0);
    const endIndex = endCandidates.length > 0 ? Math.min(...endCandidates) : slice.length;
    return slice.slice(0, endIndex);
}

function findSentenceBoundary(value: string): number {
    const match = /[。.!！?？](?:\s|$)/.exec(value);
    return match ? match.index + 1 : -1;
}

function extractOpeningSubject(content: string): { value: string; backticked: boolean } | undefined {
    const opening = content.slice(0, 500);
    const backticked = opening.match(/^\s*(?:[#>*\-.\d)\s]*)?`([^`\n]{2,80})`\s*(?:是一个|是一款|是|为|属于)/m);
    if (backticked?.[1]) {
        return { value: backticked[1], backticked: true };
    }

    const asciiIdentifier = opening.match(/^\s*(?:[#>*\-.\d)\s]*)?([A-Za-z][A-Za-z0-9_.-]{1,79})\s*(?:是一个|是一款|是|为|属于)/m);
    if (asciiIdentifier?.[1]) {
        return { value: asciiIdentifier[1], backticked: false };
    }

    return undefined;
}

function removeDanglingRestartLeadIn(content: string): string {
    return content.replace(
        /\s*(?:欢迎随时(?:告诉我|指定)|欢迎继续提问|请告诉我[！!]?|需要我帮你[:：]?|还需要我帮你[:：]?)[\s\p{P}\p{S}]*$/u,
        '',
    );
}

function hasRestartLeadInPrefix(content: string, restartIndex: number): boolean {
    const prefix = content.slice(Math.max(0, restartIndex - 96), restartIndex);
    return /(?:欢迎随时(?:告诉我|指定)|欢迎继续提问|请告诉我|需要我帮你|还需要我帮你|如需(?:进一步)?(?:了解|分析|继续)|继续(?:提问|分析|查看))/u.test(prefix);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compactIntermediateResponse(content: string): string {
    // If it doesn't look like our structured format, return as is
    if (!content.includes('--------------------------------------------------')) {
        return content.trim();
    }

    const sections = content.split(/^-{40,}/m);
    const keptSections: string[] = [];

    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        // ONLY keep EXECUTION_LOG and FILE_CHANGES during intermediate steps.
        // These are the "ground truth" of what actually happened.
        // We drop USER_PROMPT (repetition), PLAN (intent), RESULT (premature summary), 
        // and NEXT_STEPS (distraction) to keep the history focused.
        if (
            trimmed.startsWith('EXECUTION_LOG') || 
            trimmed.startsWith('FILE_CHANGES')
        ) {
            keptSections.push(`--------------------------------------------------\n${trimmed}`);
        }
    }

    // If we stripped everything but there are tool calls (JSON blocks), 
    // we need to make sure we don't return an empty string if the content had substance.
    if (keptSections.length === 0) {
        // Fallback: if we have a very short response, it might be a direct tool call explanation
        if (content.length < 500) return content.trim();
        
        // Otherwise, return a very brief placeholder to maintain turn structure
        return "[Intermediate technical step processed]";
    }

    return keptSections.join('\n\n').trim();
}
