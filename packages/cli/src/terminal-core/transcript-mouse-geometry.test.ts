import { describe, expect, it } from 'vitest';
import {
    getRustMessageLineOffset,
    projectTranscriptMessagePoint,
    projectTranscriptMouseGeometry,
    projectTranscriptSelectionPointFromRustHit,
} from './transcript-mouse-geometry.js';

describe('transcript mouse geometry', () => {
    it('projects transcript coordinates from layout row and column', () => {
        const geometry = projectTranscriptMouseGeometry(
            { messages: { x: 10, y: 4, width: 50, height: 12 } },
            100,
            7,
            33,
        );

        expect(geometry).toEqual({
            transcriptStartRow: 4,
            leftCol: 10,
            scrollbarCol: 60,
            lineIndex: 103,
            column: 23,
            copyHotspot: { left: 48, right: 60 },
        });
    });

    it('clamps projected columns to zero on the left edge', () => {
        const geometry = projectTranscriptMouseGeometry(
            { messages: { x: 12, y: 3, width: 40, height: 10 } },
            8,
            3,
            4,
        );

        expect(geometry.lineIndex).toBe(8);
        expect(geometry.column).toBe(0);
        expect(geometry.copyHotspot).toEqual({ left: 40, right: 52 });
    });

    it('projects message hit offsets into transcript points', () => {
        expect(projectTranscriptMessagePoint(12, 5, 17)).toEqual({ line: 17, column: 17 });
        expect(projectTranscriptMessagePoint(12, 5, -2, 14)).toEqual({ line: 14, column: 0 });
    });

    it('extracts Rust message line offsets from both binding field names', () => {
        expect(getRustMessageLineOffset({ lineOffset: 4 })).toBe(4);
        expect(getRustMessageLineOffset({ line_offset: 6 })).toBe(6);
        expect(getRustMessageLineOffset({})).toBeNull();
        expect(getRustMessageLineOffset(null)).toBeNull();
    });

    it('projects selection points from Rust message hits', () => {
        const layout = { messages: { x: 10, y: 4, width: 50, height: 12 } };
        const point = projectTranscriptSelectionPointFromRustHit(
            layout,
            100,
            7,
            33,
            { kind: 'message', line_offset: 3 },
            120,
        );
        expect(point).toEqual({ line: 103, column: 23 });
    });

    it('returns null for non-message Rust hits', () => {
        const layout = { messages: { x: 10, y: 4, width: 50, height: 12 } };
        const point = projectTranscriptSelectionPointFromRustHit(
            layout,
            100,
            7,
            33,
            { kind: 'scrollbar' },
            120,
        );
        expect(point).toBeNull();
    });
});
