import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolParameter } from '@xqoder/shared';
import type { ToolApprovalRequest } from './tools/tool.js';

type JsonSchemaLike = {
    type?: unknown;
    description?: unknown;
    properties?: Record<string, JsonSchemaLike>;
    required?: unknown;
};

interface McpCallToolResultLike {
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
}

interface McpPromptDescriptorLike {
    name: string;
    title?: string;
    description?: string;
    arguments?: Array<{
        name: string;
        required?: boolean;
    }>;
}

interface McpGetPromptResultLike {
    description?: string;
    messages?: Array<Record<string, unknown>>;
}

interface McpResourceDescriptorLike {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

interface McpResourceTemplateDescriptorLike {
    uriTemplate: string;
    name: string;
    description?: string;
    mimeType?: string;
}

interface McpReadResourceResultLike {
    contents?: Array<{
        uri?: string;
        mimeType?: string;
        text?: string;
        blob?: string;
    }>;
}

export function buildRoots(projectRoot: string, allowedPaths: string[] = []): Array<{ uri: string; name: string }> {
    const roots = [projectRoot, ...allowedPaths];
    const unique = Array.from(new Set(roots.map((entry) => path.resolve(entry))));

    return unique.map((entry) => ({
        uri: pathToFileURL(entry).toString(),
        name: path.basename(entry) || entry,
    }));
}

export function resolveServerCwd(
    configuredCwd: string | undefined,
    projectRoot: string,
    fallbackCwd: string,
): string {
    if (!configuredCwd) {
        return fallbackCwd;
    }

    return path.isAbsolute(configuredCwd)
        ? configuredCwd
        : path.resolve(projectRoot, configuredCwd);
}

export function createToolAlias(serverName: string, toolName: string, existing: Set<string>): string {
    const base = `mcp.${sanitizeAliasSegment(serverName)}.${sanitizeAliasSegment(toolName)}`;
    let alias = base;
    let suffix = 2;
    while (existing.has(alias)) {
        alias = `${base}_${suffix}`;
        suffix += 1;
    }
    existing.add(alias);
    return alias;
}

export function createReservedAlias(serverName: string, suffix: string, existing: Set<string>): string {
    let alias = `mcp.${sanitizeAliasSegment(serverName)}.${suffix}`;
    let counter = 2;
    while (existing.has(alias)) {
        alias = `mcp.${sanitizeAliasSegment(serverName)}.${suffix}_${counter}`;
        counter += 1;
    }
    existing.add(alias);
    return alias;
}

export function convertJsonSchemaToParameters(schema: unknown): ToolParameter[] {
    if (!schema || typeof schema !== 'object') {
        return [];
    }

    const objectSchema = schema as JsonSchemaLike;
    if (objectSchema.type !== 'object' || !objectSchema.properties) {
        return [];
    }

    const required = Array.isArray(objectSchema.required)
        ? new Set(objectSchema.required.filter((value): value is string => typeof value === 'string'))
        : new Set<string>();

    return Object.entries(objectSchema.properties).map(([name, property]) => ({
        name,
        type: resolveToolParameterType(property),
        description: typeof property.description === 'string' ? property.description : '',
        required: required.has(name),
    }));
}

export function hasCapability(
    capabilities: Record<string, unknown> | undefined,
    capabilityName: string,
): boolean {
    if (!capabilities) {
        return false;
    }

    const capability = capabilities[capabilityName];
    return Boolean(capability && typeof capability === 'object');
}

export function buildSyntheticApproval(
    toolName: string,
    serverName: string,
    summary: string,
    preview?: string,
): ToolApprovalRequest {
    return {
        toolCallId: '',
        toolName,
        summary: `${summary} @ ${serverName}`,
        reason: 'This call will access an external MCP server.',
        preview,
        risk: 'medium',
    };
}

export function requireStringArgument(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Missing required argument: ${key}`);
    }
    return value;
}

export function normalizePromptArguments(value: unknown): Record<string, string> {
    if (value === undefined) {
        return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('arguments must be an object');
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
    );
}

export function formatToolCallResult(result: McpCallToolResultLike): string {
    const sections: string[] = [];

    if (Array.isArray(result.content)) {
        for (const item of result.content) {
            if (item.type === 'text' && typeof item.text === 'string') {
                sections.push(item.text);
                continue;
            }

            if (item.type === 'resource_link' || item.type === 'resource') {
                sections.push(safeStringify(item));
                continue;
            }

            sections.push(safeStringify(item));
        }
    }

    if (result.structuredContent !== undefined) {
        sections.push(safeStringify(result.structuredContent));
    }

    return sections.filter(Boolean).join('\n\n') || '(empty MCP result)';
}

export function formatPromptList(prompts: McpPromptDescriptorLike[]): string {
    if (prompts.length === 0) {
        return 'No MCP prompts available.';
    }

    return prompts.map((prompt) => {
        const args = (prompt.arguments ?? [])
            .map((argument) => `${argument.name}${argument.required ? '*' : ''}`)
            .join(', ');
        return [
            `Prompt: ${prompt.name}`,
            prompt.title ? `Title: ${prompt.title}` : '',
            prompt.description ? `Description: ${prompt.description}` : '',
            `Arguments: ${args || '(none)'}`,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

export function formatPromptResult(promptName: string, result: McpGetPromptResultLike): string {
    const sections: string[] = [`Prompt: ${promptName}`];
    if (result.description) {
        sections.push(`Description: ${result.description}`);
    }

    const messages = (result.messages ?? []).map((message, index) => {
        const role = typeof message.role === 'string' ? message.role : `message_${index + 1}`;
        return `${role}: ${formatPromptMessageContent(message.content)}`;
    });

    if (messages.length > 0) {
        sections.push('Messages:');
        sections.push(messages.join('\n\n'));
    }

    return sections.join('\n\n');
}

export function formatResourceIndex(
    resources: McpResourceDescriptorLike[],
    templates: McpResourceTemplateDescriptorLike[],
): string {
    const sections: string[] = [];

    sections.push(resources.length > 0
        ? resources.map((resource) => [
            `Resource: ${resource.name}`,
            `URI: ${resource.uri}`,
            resource.description ? `Description: ${resource.description}` : '',
            resource.mimeType ? `MIME: ${resource.mimeType}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : 'Resources: (none)');

    sections.push(templates.length > 0
        ? templates.map((template) => [
            `Template: ${template.name}`,
            `URI Template: ${template.uriTemplate}`,
            template.description ? `Description: ${template.description}` : '',
            template.mimeType ? `MIME: ${template.mimeType}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : 'Resource Templates: (none)');

    return sections.join('\n\n');
}

export function formatReadResourceResult(uri: string, result: McpReadResourceResultLike): string {
    const contents = result.contents ?? [];
    if (contents.length === 0) {
        return `Resource: ${uri}\n\n(empty resource)`;
    }

    return contents.map((entry) => {
        const parts = [
            `Resource: ${typeof entry.uri === 'string' ? entry.uri : uri}`,
            typeof entry.mimeType === 'string' ? `MIME: ${entry.mimeType}` : '',
        ].filter(Boolean);

        if (typeof entry.text === 'string') {
            parts.push(entry.text);
        } else if (typeof entry.blob === 'string') {
            parts.push(`[blob:${entry.blob.length} bytes]`);
        } else {
            parts.push(safeStringify(entry));
        }

        return parts.join('\n\n');
    }).join('\n\n');
}

export function formatNotificationMessage(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return safeStringify(params);
    }

    const candidate = params as Record<string, unknown>;
    if (typeof candidate.data === 'string') {
        return candidate.data;
    }

    return safeStringify(params);
}

export function safeStringify(value: unknown, maxLength = 2_000): string {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (raw.length <= maxLength) {
        return raw;
    }

    return `${raw.slice(0, maxLength)}…`;
}

function sanitizeAliasSegment(value: string): string {
    const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length > 0 ? normalized : 'tool';
}

function resolveToolParameterType(schema: JsonSchemaLike): ToolParameter['type'] {
    switch (schema.type) {
        case 'number':
        case 'boolean':
        case 'object':
        case 'array':
            return schema.type;
        default:
            return 'string';
    }
}

function formatPromptMessageContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map((entry) => formatPromptMessageContent(entry)).join('\n');
    }

    if (!content || typeof content !== 'object') {
        return safeStringify(content);
    }

    const candidate = content as Record<string, unknown>;
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
        return candidate.text;
    }

    if (candidate.type === 'resource' || candidate.type === 'resource_link') {
        return safeStringify(candidate);
    }

    return safeStringify(candidate);
}
