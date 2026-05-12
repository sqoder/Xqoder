// Converts XQoder `ToolDefinition[]` into OpenAI chat-completion tool[] shape.
// Schema is routed through `normalizeSchemaForOpenAI` so we get a consistent
// additionalProperties:false and (optionally) strict-required behavior.

import type { ToolDefinition, ToolParameter } from '@xqoder/shared';
import {
    normalizeSchemaForOpenAI,
    type JsonSchemaRecord,
} from './schema-sanitizer.js';

export interface ConvertToolsOptions {
    readonly strict?: boolean;
}

export interface OpenAIToolFunction {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchemaRecord;
    readonly strict?: true;
}

export interface OpenAITool {
    readonly type: 'function';
    readonly function: OpenAIToolFunction;
}

export function convertTools(
    tools: ToolDefinition[],
    options: ConvertToolsOptions = {},
): OpenAITool[] {
    return tools.map((tool) => {
        const rawSchema: JsonSchemaRecord = {
            type: 'object',
            properties: Object.fromEntries(
                tool.parameters.map((p) => [p.name, parameterToSchema(p)]),
            ),
            required: tool.parameters.filter((p) => p.required).map((p) => p.name),
        };
        const parameters = normalizeSchemaForOpenAI(rawSchema, options);
        const fn: OpenAIToolFunction = options.strict
            ? { name: tool.name, description: tool.description, parameters, strict: true }
            : { name: tool.name, description: tool.description, parameters };
        return { type: 'function', function: fn };
    });
}

function parameterToSchema(p: ToolParameter): JsonSchemaRecord {
    const base: JsonSchemaRecord = { type: p.type, description: p.description };
    if (p.default !== undefined) {
        base.default = p.default;
    }
    return base;
}
