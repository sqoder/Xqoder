import React from 'react';
import { Box, Text } from 'ink';
import type { DOMElement } from 'ink';
import type { ScrollbarMetrics } from './message-viewport-state.js';

export const MESSAGE_SCROLLBAR_WIDTH = 3;

export interface MessageScrollbarProps {
    metrics: ScrollbarMetrics;
    height: number;
    width?: number;
    scrollbarRef?: React.RefObject<DOMElement | null>;
}

export function MessageScrollbar({
    metrics,
    height,
    width = MESSAGE_SCROLLBAR_WIDTH,
    scrollbarRef,
}: MessageScrollbarProps): React.JSX.Element {
    const thumbCell = '█'.repeat(width);
    const trackCell = '│'.repeat(width);

    return (
        <Box ref={scrollbarRef} width={width} height={height} flexDirection="column">
            {Array.from({ length: metrics.trackHeight }, (_, index) => {
                const inThumb = metrics.visible
                    && index >= metrics.thumbTop
                    && index < metrics.thumbTop + metrics.thumbHeight;

                return (
                    <Text key={`scrollbar-${index}`} color={inThumb ? '#9fb3c8' : '#2b3542'}>
                        {inThumb ? thumbCell : trackCell}
                    </Text>
                );
            })}
        </Box>
    );
}
