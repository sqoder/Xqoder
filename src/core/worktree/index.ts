// P19c — barrel for @xqoder/core-worktree.

export type { AddWorktreeResult, WorktreeInfo, WorktreeSession } from './worktree-types.js';
export {
    MAX_WORKTREE_SLUG_LENGTH,
    VALID_WORKTREE_SLUG_SEGMENT,
    validateWorktreeSlug,
} from './worktree-types.js';

export {
    addWorktree,
    countWorktreeChanges,
    findGitRoot,
    generateWorktreeSlug,
    getCurrentBranch,
    getDefaultBranch,
    listWorktrees,
    removeWorktree,
} from './worktree-manager.js';

export {
    __resetWorktreeSessionForTests,
    createWorktreeSession,
    getCurrentWorktreeSession,
    setCurrentWorktreeSession,
} from './worktree-session.js';
