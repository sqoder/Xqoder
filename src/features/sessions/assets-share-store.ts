import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    SessionShareDetails,
    SessionShareRecord,
    SessionShareStore,
    SerializedSessionUsage,
} from './assets-types.js';
import { formatDateTime, truncateText } from './assets-utils.js';
import {
    formatSessionUsageCost,
    formatSessionUsageSummary,
    readOptionalSessionUsage,
    serializeOptionalSessionUsage,
} from '../../core/agent/session/session-usage.js';

interface PersistedSessionShare {
    id: string;
    sessionId: string;
    projectRoot: string;
    title: string;
    format: 'json' | 'markdown';
    createdAt: string;
    artifactPath: string;
    usage?: SerializedSessionUsage;
}

export class FileSessionShareStore implements SessionShareStore {
    constructor(private readonly rootDir: string) {
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    createShare(input: {
        sessionId: string;
        projectRoot: string;
        title: string;
        format: 'json' | 'markdown';
        content: string;
        usage?: SerializedSessionUsage;
    }): SessionShareRecord {
        const id = createShareId();
        const directory = path.join(this.rootDir, id);
        const extension = input.format === 'json' ? 'json' : 'md';
        const artifactPath = path.join(directory, `session.${extension}`);
        const persisted: PersistedSessionShare = {
            id,
            sessionId: input.sessionId,
            projectRoot: path.resolve(input.projectRoot),
            title: input.title.trim() || 'xqoder-share',
            format: input.format,
            createdAt: new Date().toISOString(),
            artifactPath,
            ...(input.usage ? { usage: input.usage } : {}),
        };

        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(artifactPath, input.content, 'utf-8');
        fs.writeFileSync(path.join(directory, 'meta.json'), JSON.stringify(persisted, null, 2), 'utf-8');

        return toSessionShareRecord(persisted);
    }

    listShares(projectRoot?: string, limit: number = 20): SessionShareRecord[] {
        const normalizedProjectRoot = projectRoot ? path.resolve(projectRoot) : undefined;

        return fs.readdirSync(this.rootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => this.readShareSafe(path.join(this.rootDir, entry.name)))
            .filter((entry): entry is PersistedSessionShare => entry !== null)
            .map(toSessionShareRecord)
            .filter((entry) => !normalizedProjectRoot || entry.projectRoot === normalizedProjectRoot)
            .sort(compareSharesDescending)
            .slice(0, Math.max(1, limit));
    }

    getShare(id: string): SessionShareDetails | null {
        try {
            const share = this.readShare(path.join(this.rootDir, id));
            return {
                ...toSessionShareRecord(share),
                content: fs.readFileSync(share.artifactPath, 'utf-8'),
            };
        } catch {
            return null;
        }
    }

    removeShare(id: string): SessionShareRecord | null {
        const directory = path.join(this.rootDir, id);

        try {
            const share = this.readShare(directory);
            fs.rmSync(directory, { recursive: true, force: true });
            return toSessionShareRecord(share);
        } catch {
            return null;
        }
    }

    private readShare(directory: string): PersistedSessionShare {
        const metaPath = path.join(directory, 'meta.json');
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PersistedSessionShare;
    }

    private readShareSafe(directory: string): PersistedSessionShare | null {
        try {
            return this.readShare(directory);
        } catch {
            return null;
        }
    }
}

export function formatSessionShareListLine(share: SessionShareRecord): string {
    return [
        `- ${share.id}`,
        `created=${formatDateTime(share.createdAt)}`,
        `format=${share.format}`,
        `session=${share.sessionId}`,
        `title=${share.title}`,
        ...(share.usage
            ? [
                `tokens=${share.usage.totalTokens}`,
                ...(typeof share.usage.cost === 'number'
                    ? [`cost=${formatSessionUsageCost(share.usage.cost)}`]
                    : []),
            ]
            : []),
    ].join('  ');
}

export function formatSessionShareDetail(share: SessionShareDetails): string {
    const preview = truncateText(share.content.replace(/\s+/g, ' ').trim(), 280);

    return [
        `Share: ${share.id}`,
        `Session: ${share.sessionId}`,
        `Project: ${share.projectRoot}`,
        `Title: ${share.title}`,
        `Format: ${share.format}`,
        `Created: ${formatDateTime(share.createdAt)}`,
        `Artifact: ${share.artifactPath}`,
        ...(share.usage
            ? [`Usage: ${formatSessionUsageSummary(share.usage)}`]
            : []),
        '',
        `Preview: ${preview || 'None'}`,
    ].join('\n');
}

function toSessionShareRecord(value: PersistedSessionShare): SessionShareRecord {
    const usage = normalizeSharedUsage(value.usage);

    return {
        id: value.id,
        sessionId: value.sessionId,
        projectRoot: value.projectRoot,
        title: value.title,
        format: value.format,
        createdAt: new Date(value.createdAt),
        artifactPath: value.artifactPath,
        ...(usage ? { usage } : {}),
    };
}

function normalizeSharedUsage(value: SerializedSessionUsage | undefined): SerializedSessionUsage | undefined {
    if (
        typeof value?.promptTokens !== 'number'
        || typeof value?.completionTokens !== 'number'
        || typeof value?.totalTokens !== 'number'
    ) {
        return undefined;
    }

    return {
        promptTokens: value.promptTokens,
        completionTokens: value.completionTokens,
        totalTokens: value.totalTokens,
        ...serializeOptionalSessionUsage(readOptionalSessionUsage(value)),
    };
}

function createShareId(): string {
    return `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compareSharesDescending(left: SessionShareRecord, right: SessionShareRecord): number {
    const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
    if (timeDiff !== 0) {
        return timeDiff;
    }

    return right.id.localeCompare(left.id);
}
