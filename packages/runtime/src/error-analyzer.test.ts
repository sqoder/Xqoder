import { describe, expect, it } from 'vitest';
import { RuntimeErrorType } from '@xqoder/shared';
import { ErrorAnalyzer } from './error-analyzer.js';

describe('ErrorAnalyzer', () => {
    it('detects missing scripts as config errors', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze('npm ERR! Missing script: "dev"');

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.ConfigError,
        });
        expect(analysis.summaryForAgent).toContain('Missing script');
    });

    it('detects esbuild dependency resolution failures', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze('src/main.ts:5:23: ERROR: Could not resolve "react"');

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.DependencyMissing,
        });
        expect(analysis.autoFixCommands).toContain('npm install react');
    });

    it('detects missing local binaries from shell errors', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze('sh: vite: command not found');

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.DependencyMissing,
        });
    });

    it('detects required environment variables as config errors', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze('Missing required environment variable: API_BASE_URL');

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.ConfigError,
        });
        expect(analysis.errors[0]?.suggestion).toContain('API_BASE_URL');
    });

    it('detects TypeScript missing module errors as dependency issues', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze("src/main.ts(3,21): error TS2307: Cannot find module 'zod' or its corresponding type declarations.");

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.DependencyMissing,
        });
        expect(analysis.autoFixCommands).toContain('npm install zod');
    });

    it('detects port conflicts from node startup logs', () => {
        const analyzer = new ErrorAnalyzer();
        const analysis = analyzer.analyze('Error: listen EADDRINUSE: address already in use :::3000');

        expect(analysis.errors[0]).toMatchObject({
            type: RuntimeErrorType.PortConflict,
        });
        expect(analysis.errors[0]?.suggestion).toContain('3000');
    });
});
