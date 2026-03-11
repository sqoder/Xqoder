import { describe, expect, it } from 'vitest';
import type { CommandContext, CommandRegistration } from './commands.js';

describe('plugin-sdk commands', () => {
    it('CommandRegistration has required shape', async () => {
        const reg: CommandRegistration = {
            name: 'demo',
            description: 'Demo command',
            aliases: ['d'],
            run: async (ctx: CommandContext) => {
                expect(ctx.cwd).toBeDefined();
                expect(Array.isArray(ctx.args)).toBe(true);
                expect(ctx.flags && typeof ctx.flags === 'object').toBe(true);
            },
        };
        expect(reg.name).toBe('demo');
        expect(reg.description).toBe('Demo command');
        const ctx: CommandContext = { cwd: '/tmp', args: [], flags: {} };
        await reg.run(ctx);
    });
});
