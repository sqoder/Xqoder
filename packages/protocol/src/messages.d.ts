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
    url?: string;
    metadata?: JsonRecord;
}
export interface MessageToolCall {
    id: string;
    name: string;
    arguments: string;
}
export type MessageFinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
export type MessageContentPart = {
    type: 'text';
    text: string;
} | {
    type: 'reasoning';
    text: string;
} | {
    type: 'tool_call';
    toolCall: MessageToolCall;
} | {
    type: 'tool_result';
    toolCallId: string;
    output: string;
    success: boolean;
} | {
    type: 'image';
    mimeType: string;
    data?: string;
    url?: string;
} | {
    type: 'finish';
    reason: MessageFinishReason;
};
export interface CoreMessage {
    id: string;
    sessionId: string;
    role: CoreRole;
    content: string;
    createdAt: number;
    toolCallId?: string;
    thinking?: string;
    toolCalls?: MessageToolCall[];
    attachments?: MessageAttachment[];
    parts?: MessageContentPart[];
    metadata?: JsonRecord;
}
