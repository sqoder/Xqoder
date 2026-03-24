import { AgentSession, type RuntimeAgentSessionStore } from '@xqoder/agent';
import type {
    RuntimeSessionAppendInput,
    RuntimeSessionBackingStore,
    RuntimeSessionSaveInput,
    RuntimeSessionSnapshot,
    RuntimeSessionSummary,
} from '@xqoder/storage-sqlite';

export function createRuntimeSessionBackingStore(store: RuntimeAgentSessionStore): RuntimeSessionBackingStore {
    return {
        getSessionSnapshot(sessionId) {
            return store.getSessionSnapshot(sessionId) as RuntimeSessionSnapshot | null;
        },
        getSessionSummary(sessionId) {
            return store.getSessionSummary(sessionId) as RuntimeSessionSummary | null;
        },
        listSessions(projectRoot, limit) {
            return store.listSessions(projectRoot, limit) as RuntimeSessionSummary[];
        },
        saveSessionSnapshot({ snapshot, ...context }: RuntimeSessionSaveInput) {
            return store.saveSessionSnapshot({
                ...context,
                session: AgentSession.fromSnapshot(snapshot as unknown as Parameters<typeof AgentSession.fromSnapshot>[0]),
            }) as RuntimeSessionSummary;
        },
        appendSessionMessage(input: RuntimeSessionAppendInput) {
            return store.appendSessionMessage({
                sessionId: input.sessionId,
                message: input.message as Parameters<typeof store.appendSessionMessage>[0]['message'],
                projectRoot: input.projectRoot,
                cwd: input.cwd,
                model: input.model,
                ...(input.title ? { title: input.title } : {}),
            }) as RuntimeSessionSummary;
        },
    };
}
