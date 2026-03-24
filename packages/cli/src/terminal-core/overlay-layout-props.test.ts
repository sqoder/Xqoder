import { describe, expect, it } from 'vitest';
import { resolveOverlayLayoutProps } from './overlay-layout-props.js';

describe('overlay layout props', () => {
    it('normalizes item count and max width from overlay state', () => {
        expect(resolveOverlayLayoutProps(null)).toEqual({
            itemCount: 0,
            maxWidth: null,
        });

        expect(resolveOverlayLayoutProps({ items: [] }, 1)).toEqual({
            itemCount: 1,
            maxWidth: null,
        });

        expect(resolveOverlayLayoutProps({
            items: [1, 2, 3],
            maxWidth: 48,
        })).toEqual({
            itemCount: 3,
            maxWidth: 48,
        });

        expect(resolveOverlayLayoutProps({
            items: ['a'],
            max_width: 36,
        })).toEqual({
            itemCount: 1,
            maxWidth: 36,
        });
    });
});
