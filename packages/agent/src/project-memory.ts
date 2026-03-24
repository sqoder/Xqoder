import type { AgentSession } from './session/session.js';
import {
    readProjectMemoryFile,
    writeProjectMemoryFile,
    type ProjectMemorySessionSummary,
    type ProjectMemorySnapshot,
} from '@xqoder/shared';

const MAX_RECENT_COMMANDS = 4;
const MAX_RECENT_FILE_CHANGES = 6;
const MAX_RECENT_TOOLS = 6;

export function createProjectMemorySessionSummary(
    session: AgentSession,
    updatedAt: Date = new Date(),
): ProjectMemorySessionSummary {
    return {
        sessionId: session.id,
        updatedAt: updatedAt.toISOString(),
        ...(session.getCompactSummary()?.trim()
            ? { compactSummary: session.getCompactSummary()?.trim() }
            : {}),
        recentCommands: session.getCommandHistory()
            .slice(-MAX_RECENT_COMMANDS)
            .map((entry) => ({
                command: entry.command,
                success: entry.success,
            })),
        recentFileChanges: session.getFileChanges()
            .slice(-MAX_RECENT_FILE_CHANGES)
            .map((entry) => ({
                path: entry.path,
                changeType: entry.changeType,
                success: entry.success,
            })),
        recentTools: session.getToolHistory()
            .slice(-MAX_RECENT_TOOLS)
            .map((entry) => ({
                name: entry.name,
                success: entry.success,
            })),
    };
}

export function syncProjectMemoryFromSession(
    projectRoot: string,
    session: AgentSession,
    updatedAt: Date = new Date(),
): ProjectMemorySnapshot | null {
    try {
        const existing = readProjectMemoryFile(projectRoot);
        return writeProjectMemoryFile(projectRoot, {
            version: 1,
            projectRoot,
            updatedAt: updatedAt.toISOString(),
            ...(existing?.workflow ? { workflow: existing.workflow } : {}),
            session: createProjectMemorySessionSummary(session, updatedAt),
        });
    } catch {
        return null;
    }
}
