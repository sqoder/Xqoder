import { describe, expect, it } from 'vitest';
import {
    getCompleteOverlayListStartRow,
    getCompleteOverlayVisibleRows,
    projectCompleteOverlayHit,
} from './overlay-geometry.js';

describe('overlay geometry', () => {
    it('centralizes complete overlay visible rows from Rust overlay height', () => {
        expect(getCompleteOverlayVisibleRows(11, 10)).toBe(8);
        expect(getCompleteOverlayVisibleRows(11, 3)).toBe(3);
        expect(getCompleteOverlayVisibleRows(0, 10)).toBe(8);
    });

    it('projects complete overlay hit rows with the shared list start offset', () => {
        expect(getCompleteOverlayListStartRow()).toBe(2);

        const projected = projectCompleteOverlayHit(5, 11, 0, 10);
        expect(projected).toEqual({
            listStartRow: 2,
            visibleRows: 8,
            selectableRows: 8,
            anchorRow: 3,
            index: 3,
        });

        const blankRow = projectCompleteOverlayHit(10, 11, 0, 10);
        expect(blankRow.anchorRow).toBeNull();
        expect(blankRow.index).toBeNull();
    });
});
