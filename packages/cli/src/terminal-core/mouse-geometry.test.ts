import { describe, expect, it } from 'vitest';
import { toZeroBasedMousePoint } from './mouse-geometry.js';

describe('mouse geometry', () => {
    it('normalizes 1-based mouse coordinates to zero-based points', () => {
        expect(toZeroBasedMousePoint({
            type: 'mouse',
            kind: 'press',
            button: 'left',
            x: 12,
            y: 9,
            raw: '',
        })).toEqual({ row: 8, col: 11 });
    });

    it('clamps mouse coordinates at the origin', () => {
        expect(toZeroBasedMousePoint({
            type: 'mouse',
            kind: 'drag',
            button: 'left',
            x: 0,
            y: 0,
            raw: '',
        })).toEqual({ row: 0, col: 0 });
    });
});
