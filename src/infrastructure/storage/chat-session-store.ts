import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import { SQLiteSessionStore } from '@xqoder/storage-sqlite';
import type { ChatSessionStore } from '../../application/chat/ports.js';

export function createDefaultChatSessionStore(): ChatSessionStore | undefined {
    try {
        return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
    } catch (err) {
        logger.warn(`Session persistence unavailable, falling back to in-memory session: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    }
}
