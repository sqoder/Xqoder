import { describe, expect, it } from 'bun:test';
import {
    resolveTerminalLocalCommand,
    TERMINAL_LOCAL_COMMANDS,
} from '../../../../src/platform/terminal/app/run-terminal-app.js';

describe('terminal local commands', () => {
    it('recognizes all supported shell-local commands', () => {
        TERMINAL_LOCAL_COMMANDS.new.forEach((command) => {
            expect(resolveTerminalLocalCommand(command)).toBe('new');
        });

        TERMINAL_LOCAL_COMMANDS.exit.forEach((command) => {
            expect(resolveTerminalLocalCommand(command)).toBe('exit');
        });
    });

    it('ignores regular prompts', () => {
        expect(resolveTerminalLocalCommand('你好')).toBeNull();
        expect(resolveTerminalLocalCommand('/resume')).toBeNull();
        expect(resolveTerminalLocalCommand('/sessions')).toBeNull();
        expect(resolveTerminalLocalCommand('/share')).toBeNull();
    });
});
