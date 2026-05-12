import type { ShellPattern } from './dangerous-patterns.js';

/**
 * Allowlist for commands that are unambiguously read-only / informational.
 * Each regex must be anchored to start of string (^) to avoid matching when
 * a risky command is chained after a safe prefix via `&&` / `;` / `|`.
 */
export const SAFE_PATTERNS: ShellPattern[] = [
    { re: /^ls(\s+-[A-Za-z0-9]+)?(\s+\S+)*$/, reason: 'directory listing' },
    { re: /^pwd\s*$/, reason: 'print working directory' },
    { re: /^whoami\s*$/, reason: 'print current user' },
    { re: /^date\s*$/, reason: 'print current date' },
    { re: /^uname(\s+-[A-Za-z])?\s*$/, reason: 'print kernel info' },
    { re: /^cat\s+(?!\/etc|~|\/dev)\S+(\s+\S+)*$/, reason: 'concatenate project files' },
    { re: /^head(\s+-\d+)?\s+(?!\/etc|~|\/dev)\S+(\s+\S+)*$/, reason: 'head of project file' },
    { re: /^tail(\s+-\d+)?\s+(?!\/etc|~|\/dev)\S+(\s+\S+)*$/, reason: 'tail of project file' },
    { re: /^wc(\s+-[lwc])?\s+\S+(\s+\S+)*$/, reason: 'word count' },
    { re: /^stat\s+\S+(\s+\S+)*$/, reason: 'file stat' },
    { re: /^file\s+\S+(\s+\S+)*$/, reason: 'file type detection' },
    { re: /^echo\b/, reason: 'echo literal text' },
    { re: /^printf\b/, reason: 'printf literal text' },
    { re: /^grep\b(?!.*\s-[A-Za-z]*e\b)/, reason: 'grep search' },
    { re: /^rg\b/, reason: 'ripgrep search' },
    { re: /^find\s+\.(?:\s|$)/, reason: 'find within cwd' },
    { re: /^git\s+(status|diff|log|show|branch|blame|ls-files|rev-parse|config\s+--get)\b/, reason: 'git read-only' },
    { re: /^bun\s+(run\s+(build|lint|typecheck|test)|test|x\s+tsc)\b/, reason: 'bun build/test/typecheck' },
    { re: /^npm\s+(run\s+(build|lint|typecheck|test)|test)\b/, reason: 'npm build/test' },
    { re: /^yarn\s+(build|lint|typecheck|test)\b/, reason: 'yarn build/test' },
    { re: /^pnpm\s+(run\s+(build|lint|typecheck|test)|test)\b/, reason: 'pnpm build/test' },
    { re: /^node\s+--version\s*$/, reason: 'node version' },
    { re: /^bun\s+--version\s*$/, reason: 'bun version' },
    { re: /^which\s+\S+\s*$/, reason: 'locate binary' },
    { re: /^env\s*$/, reason: 'print environment' },
];
