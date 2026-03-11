import { describe, expect, it } from 'vitest';
import { collectModifiedFiles, truncateSidebarPath } from './sidebar.js';

describe('sidebar helpers', () => {
    it('aggregates repeated file changes into one modified file summary', () => {
        const summaries = collectModifiedFiles([
            {
                filePath: '/repo/src/app.tsx',
                before: 'const a = 1\n',
                after: 'const a = 2\n',
                toolName: 'edit',
                timestamp: new Date('2026-03-10T10:00:00.000Z'),
            },
            {
                filePath: '/repo/src/app.tsx',
                before: 'const a = 2\n',
                after: 'const a = 2\nconst b = 3\n',
                toolName: 'edit',
                timestamp: new Date('2026-03-10T10:01:00.000Z'),
            },
        ], '/repo');

        expect(summaries).toEqual([
            {
                path: 'src/app.tsx',
                additions: 2,
                removals: 1,
                changeCount: 2,
            },
        ]);
    });

    it('truncates long sidebar paths from the left', () => {
        expect(truncateSidebarPath('src/features/editor/input-state.ts', 16)).toBe('...nput-state.ts');
        expect(truncateSidebarPath('short.ts', 16)).toBe('short.ts');
    });
});
