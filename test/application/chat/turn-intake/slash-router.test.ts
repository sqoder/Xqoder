import { describe, expect, it } from 'bun:test';
import { resolveChatCommandRoute, isDirectChatCommandRoute } from '../../../../src/application/chat/command-router.js';

describe('slash router /help', () => {
    it('routes /help to a direct help command', () => {
        const route = resolveChatCommandRoute('/help');
        expect(route.kind).toBe('help');
    });

    it('routes /? alias to help too', () => {
        const route = resolveChatCommandRoute('/?');
        expect(route.kind).toBe('help');
    });

    it('marks help as a direct command (short-circuits main loop)', () => {
        const route = resolveChatCommandRoute('/help');
        expect(isDirectChatCommandRoute(route)).toBe(true);
    });

    it('does not treat an email-like string as a slash command', () => {
        const route = resolveChatCommandRoute('please email user@example.com');
        expect(route.kind).toBe('none');
    });
});
