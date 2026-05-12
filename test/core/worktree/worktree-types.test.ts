// P19c — worktree-types unit tests.

import { describe, expect, it } from 'bun:test';
import { validateWorktreeSlug } from '../../../src/core/worktree/worktree-types.js';

describe('validateWorktreeSlug', () => {
    it('accepts simple alphanumeric slugs', () => {
        expect(() => validateWorktreeSlug('feature-foo')).not.toThrow();
        expect(() => validateWorktreeSlug('abc123')).not.toThrow();
        expect(() => validateWorktreeSlug('my.branch')).not.toThrow();
    });

    it('accepts slash-separated segments', () => {
        expect(() => validateWorktreeSlug('feature/my-thing')).not.toThrow();
        expect(() => validateWorktreeSlug('a/b/c')).not.toThrow();
    });

    it('rejects empty string', () => {
        expect(() => validateWorktreeSlug('')).toThrow(/empty/);
    });

    it('rejects whitespace-only string', () => {
        expect(() => validateWorktreeSlug('   ')).toThrow(/empty/);
    });

    it('rejects names longer than 64 chars', () => {
        expect(() => validateWorktreeSlug('a'.repeat(65))).toThrow(/64/);
    });

    it('accepts exactly 64 chars', () => {
        expect(() => validateWorktreeSlug('a'.repeat(64))).not.toThrow();
    });

    it('rejects path traversal segments', () => {
        expect(() => validateWorktreeSlug('../escape')).toThrow(/invalid/i);
        expect(() => validateWorktreeSlug('foo/../../etc')).toThrow(/invalid/i);
    });

    it('rejects segments with spaces', () => {
        expect(() => validateWorktreeSlug('my branch')).toThrow(/invalid/i);
    });

    it('rejects segments with special chars', () => {
        expect(() => validateWorktreeSlug('foo@bar')).toThrow(/invalid/i);
        expect(() => validateWorktreeSlug('foo:bar')).toThrow(/invalid/i);
    });

    it('rejects empty segment from leading slash', () => {
        expect(() => validateWorktreeSlug('/leading')).toThrow(/invalid/i);
    });

    it('rejects empty segment from trailing slash', () => {
        expect(() => validateWorktreeSlug('trailing/')).toThrow(/invalid/i);
    });
});
