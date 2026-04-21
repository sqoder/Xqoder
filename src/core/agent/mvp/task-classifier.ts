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
    const matches = userMessage.match(/(?:\.{0,2}\/)?[\w./-]+\.[A-Za-z0-9]+/g) ?? [];
    return Array.from(new Set(matches.map((match) => match.trim()).filter(Boolean))).slice(0, 8);
}
