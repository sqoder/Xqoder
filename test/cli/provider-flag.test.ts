// P10 provider-flag unit tests — clean-room port parity checks.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    VALID_PROVIDERS,
    applyModelFlagFromArgs,
    applyProviderFlag,
    applyProviderFlagFromArgs,
    parseModelFlag,
    parseProviderFlag,
} from '../../src/cli/provider-flag.js';

const PROVIDER_ENV_KEYS = [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_MISTRAL',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'ANTHROPIC_MODEL',
    'OPENAI_MODEL',
    'GEMINI_MODEL',
    'MISTRAL_MODEL',
    'OPENAI_BASE_URL',
    'OPENAI_API_KEY',
];

const snapshots = new Map<string, string | undefined>();

beforeEach(() => {
    snapshots.clear();
    for (const key of PROVIDER_ENV_KEYS) {
        snapshots.set(key, process.env[key]);
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of PROVIDER_ENV_KEYS) {
        const value = snapshots.get(key);
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

describe('parseProviderFlag / parseModelFlag', () => {
    it('returns null when flag absent', () => {
        expect(parseProviderFlag(['--model', 'foo'])).toBeNull();
        expect(parseModelFlag(['--provider', 'openai'])).toBeNull();
    });

    it('treats --flag at end of argv as missing value', () => {
        expect(parseProviderFlag(['--provider'])).toBeNull();
        expect(parseModelFlag(['--model'])).toBeNull();
    });

    it('treats following --flag as missing value', () => {
        expect(parseProviderFlag(['--provider', '--model'])).toBeNull();
    });

    it('extracts value when followed by a normal token', () => {
        expect(parseProviderFlag(['--provider', 'openai'])).toBe('openai');
        expect(parseModelFlag(['--model', 'gpt-5'])).toBe('gpt-5');
    });
});

describe('applyProviderFlag', () => {
    it('rejects unknown providers with a listing', () => {
        const out = applyProviderFlag('banana', []);
        expect(out.error).toBeDefined();
        expect(out.error).toContain('Valid providers:');
    });

    it('anthropic clears all USE_* flags and keeps ANTHROPIC_MODEL when --model provided', () => {
        process.env.CLAUDE_CODE_USE_OPENAI = '1';
        applyProviderFlag('anthropic', ['--model', 'claude-4.5-sonnet']);
        expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined();
        expect(process.env.ANTHROPIC_MODEL).toBe('claude-4.5-sonnet');
    });

    it('openai sets CLAUDE_CODE_USE_OPENAI and OPENAI_MODEL', () => {
        applyProviderFlag('openai', ['--model', 'gpt-5']);
        expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1');
        expect(process.env.OPENAI_MODEL).toBe('gpt-5');
    });

    it('ollama sets base url + api key defaults without clobbering existing values', () => {
        process.env.OPENAI_BASE_URL = 'http://existing';
        applyProviderFlag('ollama', ['--model', 'llama3.2']);
        expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1');
        expect(process.env.OPENAI_BASE_URL).toBe('http://existing');
        expect(process.env.OPENAI_API_KEY).toBe('ollama');
        expect(process.env.OPENAI_MODEL).toBe('llama3.2');
    });

    it('gemini / mistral / github set their own USE_* and model vars', () => {
        applyProviderFlag('gemini', ['--model', 'gemini-2.0-flash']);
        expect(process.env.CLAUDE_CODE_USE_GEMINI).toBe('1');
        expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash');

        applyProviderFlag('mistral', ['--model', 'ministral-3b-latest']);
        expect(process.env.CLAUDE_CODE_USE_MISTRAL).toBe('1');
        expect(process.env.MISTRAL_MODEL).toBe('ministral-3b-latest');

        applyProviderFlag('github', ['--model', 'gpt-5']);
        expect(process.env.CLAUDE_CODE_USE_GITHUB).toBe('1');
        expect(process.env.OPENAI_MODEL).toBe('gpt-5');
    });

    it('applyProviderFlagFromArgs returns undefined when no --provider', () => {
        expect(applyProviderFlagFromArgs(['--model', 'foo'])).toBeUndefined();
    });
});

describe('applyModelFlagFromArgs standalone', () => {
    it('skips when --provider is present (that path handles model)', () => {
        applyModelFlagFromArgs(['--provider', 'openai', '--model', 'gpt-5']);
        expect(process.env.OPENAI_MODEL).toBeUndefined();
    });

    it('routes to GEMINI_MODEL when USE_GEMINI already set', () => {
        process.env.CLAUDE_CODE_USE_GEMINI = '1';
        applyModelFlagFromArgs(['--model', 'gemini-2.0-flash']);
        expect(process.env.GEMINI_MODEL).toBe('gemini-2.0-flash');
    });

    it('defaults to ANTHROPIC_MODEL when no USE_* flag set', () => {
        applyModelFlagFromArgs(['--model', 'claude-4.5-sonnet']);
        expect(process.env.ANTHROPIC_MODEL).toBe('claude-4.5-sonnet');
    });
});

describe('VALID_PROVIDERS table', () => {
    it('includes the seven most common provider names', () => {
        for (const name of ['anthropic', 'openai', 'ollama', 'gemini', 'mistral', 'github', 'bedrock']) {
            expect((VALID_PROVIDERS as readonly string[]).includes(name)).toBe(true);
        }
    });
});
