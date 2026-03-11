import { describe, expect, it } from 'vitest';
import { ScreenBuffer } from './screen-buffer.js';

describe('screen buffer', () => {
    it('writes text and computes compact patches', () => {
        const before = ScreenBuffer.empty({ width: 8, height: 2 });
        const after = before.clone();
        after.writeText(0, 0, 'hello');

        expect(after.toLines()[0]).toBe('hello   ');
        expect(before.diff(after)).toEqual([
            { x: 0, y: 0, text: 'hello', style: {} },
        ]);
    });

    it('does not inject visible spacer cells for wide characters', () => {
        const buffer = ScreenBuffer.empty({ width: 8, height: 1 });
        buffer.writeText(0, 0, '你好');

        expect(buffer.toLines()[0]?.trimEnd()).toBe('你好');
        expect(ScreenBuffer.empty({ width: 8, height: 1 }).diff(buffer)).toEqual([
            { x: 0, y: 0, text: '你好', style: {} },
        ]);
    });
});
