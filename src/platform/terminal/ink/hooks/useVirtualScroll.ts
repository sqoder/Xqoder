// P22c — useVirtualScroll: viewport-based message list scroll state.
import { useState, useCallback } from 'react';

export interface UseVirtualScrollOptions {
    totalItems: number;
    viewportSize: number;
}

export interface UseVirtualScrollResult {
    scrollOffset: number;
    visibleRange: { start: number; end: number };
    scrollToBottom: () => void;
    scrollUp: (lines?: number) => void;
    scrollDown: (lines?: number) => void;
    isAtBottom: boolean;
}

export function useVirtualScroll({ totalItems, viewportSize }: UseVirtualScrollOptions): UseVirtualScrollResult {
    const maxOffset = Math.max(0, totalItems - viewportSize);
    const [scrollOffset, setScrollOffset] = useState(maxOffset);

    const scrollToBottom = useCallback(() => {
        setScrollOffset(Math.max(0, totalItems - viewportSize));
    }, [totalItems, viewportSize]);

    const scrollUp = useCallback((lines = 3) => {
        setScrollOffset((o) => Math.max(0, o - lines));
    }, []);

    const scrollDown = useCallback((lines = 3) => {
        setScrollOffset((o) => Math.min(Math.max(0, totalItems - viewportSize), o + lines));
    }, [totalItems, viewportSize]);

    const clampedOffset = Math.min(scrollOffset, maxOffset);
    const start = clampedOffset;
    const end = Math.min(totalItems, clampedOffset + viewportSize);
    const isAtBottom = clampedOffset >= maxOffset;

    return {
        scrollOffset: clampedOffset,
        visibleRange: { start, end },
        scrollToBottom,
        scrollUp,
        scrollDown,
        isAtBottom,
    };
}
