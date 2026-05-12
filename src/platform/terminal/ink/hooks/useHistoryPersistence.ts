// P06 follow-up — useHistoryPersistence: load/save input history to disk.
import { useRef, useCallback } from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HISTORY_PATH = path.join(os.homedir(), '.xqoder', 'history.json');
const MAX_HISTORY = 500;

function loadHistory(filePath = HISTORY_PATH): string[] {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter((item): item is string => typeof item === 'string').slice(-MAX_HISTORY);
            }
        }
    } catch {
        // Silently ignore — history is non-critical
    }
    return [];
}

function saveHistory(history: string[], filePath = HISTORY_PATH): void {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const deduped = Array.from(new Set(history)).slice(-MAX_HISTORY);
        fs.writeFileSync(filePath, JSON.stringify(deduped, null, 2), 'utf-8');
    } catch {
        // Silently ignore
    }
}

export interface UseHistoryPersistenceResult {
    history: string[];
    addEntry: (text: string) => void;
}

export function useHistoryPersistence(filePath = HISTORY_PATH): UseHistoryPersistenceResult {
    const historyRef = useRef<string[]>(loadHistory(filePath));

    const addEntry = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // Remove duplicate if exists, then append
        historyRef.current = historyRef.current.filter((h) => h !== trimmed);
        historyRef.current.push(trimmed);
        if (historyRef.current.length > MAX_HISTORY) {
            historyRef.current = historyRef.current.slice(-MAX_HISTORY);
        }
        saveHistory(historyRef.current, filePath);
    }, [filePath]);

    return { history: historyRef.current, addEntry };
}

export { loadHistory, saveHistory };
