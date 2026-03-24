import type { ToolCall } from './tool-types.js';

// ---- Agent / Message 相关类型 ----

/** LLM 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type MessageAttachmentKind = 'image' | 'file';

/** 消息附件 */
export interface MessageAttachment {
    /** 协议语义上的附件种类。 */
    kind: MessageAttachmentKind;
    /** @deprecated 兼容旧调用方，逐步迁移到 kind。 */
    type?: MessageAttachmentKind;
    mimeType?: string;
    /** Base64 编码的数据 */
    data?: string;
    /** 文件路径（本地） */
    filePath?: string;
    /** URL（远程） */
    url?: string;
    fileName?: string;
}

/** 结构化消息结束原因 */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';

export type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool_call'; toolCall: ToolCall }
    | { type: 'tool_result'; toolCallId: string; output: string; success: boolean }
    | { type: 'image'; mimeType: string; data?: string; url?: string }
    | { type: 'finish'; reason: FinishReason };

/** LLM 消息 */
export interface LLMMessage {
    role: MessageRole;
    content: string;
    /** 工具调用 ID（tool 角色时使用） */
    toolCallId?: string;
    /** 工具调用请求（assistant 角色时使用） */
    toolCalls?: ToolCall[];
    /** 推理/思考内容（extended thinking 模型产生） */
    thinking?: string;
    /** 二进制内容（图片等附件） */
    attachments?: MessageAttachment[];
    /** 结构化内容片段 (可选，与 content 并存以保持向后兼容) */
    parts?: ContentPart[];
}

export function getMessageAttachmentKind(attachment: Pick<MessageAttachment, 'kind' | 'type'>): MessageAttachmentKind {
    return attachment.kind ?? attachment.type ?? 'file';
}

/** 从 ContentPart 数组中提取纯文本 */
export function getTextContent(parts: ContentPart[]): string {
    return parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
}

/** 从 ContentPart 数组中提取思考内容 */
export function getReasoningContent(parts: ContentPart[]): string {
    return parts.filter((part) => part.type === 'reasoning').map((part) => part.text).join('');
}

/** 从 ContentPart 数组中提取工具调用 */
export function getToolCallParts(parts: ContentPart[]): ToolCall[] {
    return parts
        .filter((part): part is Extract<ContentPart, { type: 'tool_call' }> => part.type === 'tool_call')
        .map((part) => part.toolCall);
}
