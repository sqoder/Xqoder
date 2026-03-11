// ============================================================
// useDimensions — 终端尺寸监听 Hook
// 从 app.tsx 提取的 stdout resize 监听逻辑
// ============================================================

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';
import type { Dimensions } from './types.js';

/**
 * 监听终端尺寸变化，返回当前 { width, height }
 * 在窗口 resize 时自动更新
 */
export function useDimensions(): Dimensions {
    const { stdout } = useStdout();
    const [dimensions, setDimensions] = useState<Dimensions>({
        width: stdout.columns ?? 80,
        height: stdout.rows ?? 24,
    });

    useEffect(() => {
        const handleResize = () => {
            setDimensions({
                width: stdout.columns ?? 80,
                height: stdout.rows ?? 24,
            });
        };

        stdout.on('resize', handleResize);
        return () => {
            stdout.off('resize', handleResize);
        };
    }, [stdout]);

    return dimensions;
}
