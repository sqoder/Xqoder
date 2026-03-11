import type { JsonRecord } from './json.js';
export type CoreRole = 'system' | 'user' | 'assistant' | 'tool';
export type AttachmentKind = 'image' | 'file' | 'text';
export interface MessageAttachment {
    kind: AttachmentKind;
    fileName?: string;
    filePath?: string;
    mimeType?: string;
    data?: string;
    text?: string;
    metadata?: JsonRecord;
}
export interface CoreMessage {
    id: string;
    sessionId: string;
    role: CoreRole;
    content: string;
    createdAt: number;
    toolCallId?: string;
    attachments?: MessageAttachment[];
    metadata?: JsonRecord;
}
