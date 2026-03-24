import * as path from 'node:path';
import { extractAttachmentReferencesFromPrompt, mergeAttachmentPaths } from '../attachment-references.js';
import { extractContextReferencesFromPrompt, scanSymbolMatches } from '../context-references.js';
import type { MessageAttachment } from '@xqoder/shared';
import {
    createRuntimeSessionResolveStoreAdapter,
    listResolvedSessionSummaries,
    resolveSessionById,
} from '../services/session-resolve.js';
import { RemoteTuiAgentService, type LocalTuiSessionStore, type TuiAgentService, type TuiAgentSettings } from '../tui/agent-service.js';

interface SubmitContextDeps {
    eventLoop: any;
    sessionStore: LocalTuiSessionStore | null;
    attachBaseUrl?: string;
    agentService: TuiAgentService | RemoteTuiAgentService;
    getSettings: () => TuiAgentSettings;
    getActiveSessionId: () => string | undefined;
    maxTerminalAttachments: number;
    formatAttachmentLabel: (filePath: string) => string;
    inferAttachmentKind: (filePath: string) => 'file' | 'image' | 'text';
}

async function resolveSessionContextBlock(target: string | undefined, deps: SubmitContextDeps): Promise<{ block?: string; error?: string }> {
    const normalized = target?.trim().toLowerCase();
    const settings = deps.getSettings();

    if (deps.attachBaseUrl) {
        const remote = deps.agentService as RemoteTuiAgentService;
        const projectRoot = deps.eventLoop.getState().cwd ?? settings.dir;
        const sessionId = !normalized || normalized === 'current'
            ? deps.getActiveSessionId()
            : (normalized === 'latest' ? (await remote.listSessions(projectRoot, 1))[0]?.id : target?.trim());
        if (!sessionId) {
            return { error: target ? `Session not found for @session:${target}` : 'No active session for @session' };
        }
        try {
            const messages = (await remote.getSessionMessages(sessionId)).messages;
            const recentLines = messages.slice(-6).map((message, index) => {
                const role = message.role === 'assistant' ? 'assistant' : message.role;
                const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
                const preview = content.length > 220 ? `${content.slice(0, 217)}...` : content;
                return `${index + 1}. [${role}] ${preview}`;
            });
            return { block: ['[SessionContext]', `sessionId: ${sessionId}`, 'recentMessages:', ...(recentLines.length > 0 ? recentLines : ['(empty)']), '[/SessionContext]'].join('\n') };
        } catch {
            return { error: `Session not found: ${sessionId}` };
        }
    }

    const projectRoot = deps.eventLoop.getState().cwd ?? settings.dir;
    const runtimeStore = deps.sessionStore
        ? createRuntimeSessionResolveStoreAdapter(deps.sessionStore, {
            projectRoot,
            cwd: projectRoot,
            model: settings.model,
        })
        : null;
    const sessionId = !normalized || normalized === 'current'
        ? deps.getActiveSessionId()
        : (normalized === 'latest' && runtimeStore
            ? (await listResolvedSessionSummaries(runtimeStore, projectRoot, 1))[0]?.id
            : target?.trim());
    if (!sessionId || !runtimeStore) {
        return { error: target ? `Session not found for @session:${target}` : 'No active session for @session' };
    }
    const resolved = await resolveSessionById(runtimeStore, sessionId);
    if (!resolved) {
        return { error: `Session not found: ${sessionId}` };
    }
    const session = resolved.session;
    const summary = resolved.summary;
    const recentLines = session.getMessages().slice(-6).map((message, index) => {
        const role = message.role === 'assistant' ? 'assistant' : message.role;
        const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
        const preview = content.length > 220 ? `${content.slice(0, 217)}...` : content;
        return `${index + 1}. [${role}] ${preview}`;
    });
    return {
        block: [
            '[SessionContext]',
            `sessionId: ${summary.id}`,
            `title: ${summary.title || 'Untitled session'}`,
            `updatedAt: ${summary.updatedAt.toISOString()}`,
            'recentMessages:',
            ...(recentLines.length > 0 ? recentLines : ['(empty)']),
            '[/SessionContext]',
        ].join('\n'),
    };
}

export async function buildSubmitPayload(prompt: string, state: any, deps: SubmitContextDeps): Promise<{ promptText: string; attachments: MessageAttachment[] }> {
    const settings = deps.getSettings();
    const extractedReferences = extractAttachmentReferencesFromPrompt(prompt, state.cwd ?? settings.dir);
    const contextRefParseInput = extractedReferences.text.trim().length > 0 ? extractedReferences.text : prompt;
    const extractedContextReferences = extractContextReferencesFromPrompt(contextRefParseInput);

    const existingAttachmentPaths = state.editor.attachments
        .map((attachment: { path?: string }) => attachment.path)
        .filter((attachmentPath: unknown): attachmentPath is string => typeof attachmentPath === 'string' && attachmentPath.length > 0);
    const mergedAttachmentPaths = mergeAttachmentPaths(existingAttachmentPaths, extractedReferences.attachmentPaths, deps.maxTerminalAttachments);
    const existingAttachmentByPath = new Map<string, any>();
    for (const attachment of state.editor.attachments) {
        if (attachment.path) {
            existingAttachmentByPath.set(path.resolve(attachment.path), attachment);
        }
    }
    const attachmentModels = mergedAttachmentPaths.paths.map((filePath) => {
        const normalizedPath = path.resolve(filePath);
        return existingAttachmentByPath.get(normalizedPath) ?? {
            id: normalizedPath,
            label: deps.formatAttachmentLabel(normalizedPath),
            kind: deps.inferAttachmentKind(normalizedPath),
            path: normalizedPath,
        };
    });
    const attachments: MessageAttachment[] = attachmentModels.map((attachment) => ({
        kind: attachment.kind === 'image' ? 'image' : 'file',
        type: attachment.kind === 'image' ? 'image' : 'file',
        mimeType: attachment.kind === 'image' ? 'image/png' : 'application/octet-stream',
        fileName: attachment.label,
        filePath: attachment.path,
    }));

    const settingsDir = settings.dir;
    const cwd = deps.eventLoop.getState().cwd ?? settingsDir;
    const contextBlocks: string[] = [];
    for (const sessionReference of extractedContextReferences.sessionReferences) {
        const resolved = await resolveSessionContextBlock(sessionReference.target, deps);
        if (resolved.block) contextBlocks.push(resolved.block);
        else if (resolved.error) deps.eventLoop.dispatch({ type: 'notice.set', notice: resolved.error });
    }
    for (const symbolReference of extractedContextReferences.symbolReferences) {
        const matches = scanSymbolMatches(cwd, symbolReference.query, 6);
        if (matches.length === 0) {
            deps.eventLoop.dispatch({ type: 'notice.set', notice: `No symbols found for @symbol:${symbolReference.query}` });
            continue;
        }
        contextBlocks.push([
            '[SymbolContext]',
            `query: ${symbolReference.query}`,
            ...matches.map((match) => {
                const relPath = path.relative(cwd, match.path);
                const displayPath = relPath && !relPath.startsWith('..') ? relPath : match.path;
                return `- ${displayPath}:${match.line} | ${match.content}`;
            }),
            '[/SymbolContext]',
        ].join('\n'));
    }

    const basePromptText = extractedContextReferences.text.trim().length > 0 ? extractedContextReferences.text : contextRefParseInput;
    const promptWithContext = contextBlocks.length > 0 ? `${basePromptText}\n\n${contextBlocks.join('\n\n')}` : basePromptText;
    const promptText = state.interactionMode === 'plan'
        ? [
            '[Mode: PLAN]',
            'Provide a concrete implementation plan first.',
            'You may inspect the project using read-only tools (read/list/glob/grep/web).',
            'Do not modify files and do not run mutating commands until the user confirms Build mode.',
            '',
            promptWithContext,
        ].join('\n')
        : promptWithContext;

    return { promptText, attachments };
}
