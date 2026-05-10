// P10 fast-path detector unit tests.
// Confirms the dispatcher's argv → handler mapping stays tight. Each case
// matches a slice of phase-10's DoD checklist.

import { describe, expect, it } from 'bun:test';
import { detectFastPath } from '../../src/cli/fast-path.js';

describe('detectFastPath — long flags', () => {
    it('--dump-system-prompt anywhere in argv routes to dump-system-prompt', () => {
        expect(detectFastPath(['--dump-system-prompt'])?.handler).toBe('dump-system-prompt');
        expect(detectFastPath(['--model', 'claude-4.5-sonnet', '--dump-system-prompt'])?.handler).toBe('dump-system-prompt');
    });

    it('--daemon-worker routes to daemon-worker', () => {
        expect(detectFastPath(['--daemon-worker'])?.handler).toBe('daemon-worker');
    });

    it('each chrome/coordinator long flag maps to its handler', () => {
        expect(detectFastPath(['--claude-in-chrome-mcp'])?.handler).toBe('claude-in-chrome-mcp');
        expect(detectFastPath(['--chrome-native-host'])?.handler).toBe('chrome-native-host');
        expect(detectFastPath(['--computer-use-mcp'])?.handler).toBe('computer-use-mcp');
        expect(detectFastPath(['--environment-runner'])?.handler).toBe('environment-runner');
        expect(detectFastPath(['--self-hosted-runner'])?.handler).toBe('self-hosted-runner');
    });
});

describe('detectFastPath — bare subcommands', () => {
    it('daemon / ps / logs / attach / kill each route to their own handler', () => {
        expect(detectFastPath(['daemon'])?.handler).toBe('daemon');
        expect(detectFastPath(['ps'])?.handler).toBe('ps');
        expect(detectFastPath(['logs'])?.handler).toBe('logs');
        expect(detectFastPath(['attach'])?.handler).toBe('attach');
        expect(detectFastPath(['kill'])?.handler).toBe('kill');
    });

    it('remote-control and its alias rc map to the same handler when no subverb', () => {
        expect(detectFastPath(['remote-control'])?.handler).toBe('remote-control');
        expect(detectFastPath(['rc'])?.handler).toBe('remote-control');
    });

    it('rc new / list / reply route to dedicated handlers', () => {
        expect(detectFastPath(['rc', 'new'])?.handler).toBe('rc-new');
        expect(detectFastPath(['rc', 'list'])?.handler).toBe('rc-list');
        expect(detectFastPath(['rc', 'reply'])?.handler).toBe('rc-reply');
    });
});

describe('detectFastPath — ignored inputs', () => {
    it('chat / config / serve are full-program commands, never fast-path', () => {
        expect(detectFastPath(['chat'])).toBeUndefined();
        expect(detectFastPath(['config'])).toBeUndefined();
        expect(detectFastPath(['serve'])).toBeUndefined();
    });

    it('empty argv falls through to the main program', () => {
        expect(detectFastPath([])).toBeUndefined();
    });

    it('--provider / --model by themselves are handled before dispatch, not here', () => {
        expect(detectFastPath(['--provider', 'openai'])).toBeUndefined();
        expect(detectFastPath(['--model', 'gpt-5'])).toBeUndefined();
    });

    it('--worktree is handled by the root shell, not fast-path', () => {
        expect(detectFastPath(['--worktree', 'feature-branch'])).toBeUndefined();
    });
});
