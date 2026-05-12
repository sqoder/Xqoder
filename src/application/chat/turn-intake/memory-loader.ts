import type { MemoryBlock } from '../../memory/memdir.js';
import { loadMemdirContext } from '../../memory/memdir.js';

export type { MemoryBlock } from '../../memory/memdir.js';

export async function loadTurnMemoryBlocks(options: {
    cwd: string;
    sessionId?: string;
    prompt: string;
}): Promise<MemoryBlock[]> {
    const result = await loadMemdirContext({
        cwd: options.cwd,
        sessionId: options.sessionId ?? 'pending',
        prompt: options.prompt,
    });
    return result.memories;
}

export function renderMemoryAppendix(memories: readonly MemoryBlock[]): string | undefined {
    if (memories.length === 0) return undefined;
    const lines: string[] = ['Project memory (relevant):'];
    for (const memory of memories) {
        lines.push('', `- ${memory.filePath} [${memory.source}]`, memory.content);
    }
    return lines.join('\n');
}
