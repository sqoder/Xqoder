import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MvpTaskType } from './types.js';

const BUGFIX_PATTERN = /\b(fix|bug|error|broken|failing|failure|exception|stack trace|typeerror|修复|报错|异常|挂了)\b/i;
const REFACTOR_PATTERN = /\b(refactor|cleanup|clean up|simplify|拆分|重构|去臃肿|优化结构)\b/i;
const FEATURE_PATTERN = /(?:\b(add|implement|create|build|support|feature|update|modify|edit|delete|remove|rename|move|copy|save|write|install|run|execute)\b|新增|实现|接入|做一个|创建|生成|写一个|修改|编辑|更新|删除|移除|重命名|移动|复制|保存|写入|安装|运行|执行|新建)/i;

export function classifyMvpTask(userMessage: string): MvpTaskType {
    const normalized = userMessage.trim();

    if (BUGFIX_PATTERN.test(normalized)) {
        return 'bugfix';
    }

    if (REFACTOR_PATTERN.test(normalized)) {
        return 'refactor';
    }

    if (FEATURE_PATTERN.test(normalized)) {
        return 'feature';
    }

    return 'question';
}

export function extractCandidatePaths(userMessage: string): string[] {
    const messageWithoutUrls = stripHttpUrls(userMessage);
    const candidates = [
        ...extractLocalPathTokens(messageWithoutUrls),
        ...(messageWithoutUrls.match(/(?:\.{0,2}\/)?[\w./-]+\.[A-Za-z0-9]+/g) ?? []),
    ];

    return Array.from(new Set(candidates.map((match) => match.trim()).filter(Boolean))).slice(0, 8);
}

export function extractTargetUrls(userMessage: string): string[] {
    const matches = userMessage.match(HTTP_URL_PATTERN) ?? [];
    const normalized = matches
        .map(normalizeUrlToken)
        .filter((value): value is string => value !== undefined);

    return Array.from(new Set(normalized)).slice(0, 8);
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s"'`)\]}<>\u3000\u3400-\u9fff]+/giu;

function stripHttpUrls(userMessage: string): string {
    return userMessage.replace(HTTP_URL_PATTERN, ' ');
}

function normalizeUrlToken(token: string): string | undefined {
    const candidate = token
        .trim()
        .replace(/[),.;:!?，。；：！？]+$/u, '');
    if (!candidate) {
        return undefined;
    }

    try {
        const parsed = new URL(candidate);
        return parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '/' : '');
    } catch {
        return undefined;
    }
}

function extractLocalPathTokens(userMessage: string): string[] {
    const matches: string[] = [];
    const pattern = /(?:^|[\s"'`([{<])((?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])\S+)/g;

    for (const match of userMessage.matchAll(pattern)) {
        const candidate = normalizePathToken(match[1] ?? '');
        if (candidate) {
            matches.push(candidate);
        }
    }

    return matches;
}

function normalizePathToken(token: string): string | undefined {
    let candidate = token
        .trim()
        .replace(/[),.;:!?，。；：！？]+$/u, '');
    if (!candidate) {
        return undefined;
    }

    const existingPrefix = trimToExistingPath(candidate);
    if (existingPrefix && shouldUseExistingPrefix(candidate, existingPrefix)) {
        candidate = existingPrefix;
    }

    return candidate;
}

function shouldUseExistingPrefix(candidate: string, existingPrefix: string): boolean {
    if (candidate === existingPrefix) {
        return true;
    }

    if (!looksLikeFilePath(candidate)) {
        return true;
    }

    const expandedPrefix = expandHome(existingPrefix);
    try {
        return !fs.statSync(expandedPrefix).isDirectory();
    } catch {
        return true;
    }
}

function looksLikeFilePath(candidate: string): boolean {
    return path.extname(path.basename(candidate)) !== '';
}

function trimToExistingPath(candidate: string): string | undefined {
    const expanded = expandHome(candidate);

    if (fs.existsSync(expanded)) {
        return candidate;
    }

    for (let end = candidate.length - 1; end > 0; end -= 1) {
        const prefix = candidate.slice(0, end).replace(/[),.;:!?，。；：！？]+$/u, '');
        if (!prefix) {
            continue;
        }
        const expandedPrefix = expandHome(prefix);
        if (fs.existsSync(expandedPrefix)) {
            return prefix;
        }
    }

    return undefined;
}

function expandHome(candidate: string): string {
    return candidate.startsWith('~/')
        ? `${os.homedir()}${candidate.slice(1)}`
        : candidate;
}
