// Barrel for the OpenAI shim family. Exports pure utilities (for tests /
// provider authors) plus the concrete `OpenAIShimProvider`.

export { convertMessages, type OpenAIChatMessage, type OpenAIToolCallMessage } from './convert-messages.js';
export { convertTools, type OpenAITool, type OpenAIToolFunction, type ConvertToolsOptions } from './convert-tools.js';
export { normalizeSchemaForOpenAI, type JsonSchemaRecord, type SanitizeOptions } from './schema-sanitizer.js';
export { ThinkTagFilter, type ThinkTagFilterOptions } from './think-tag-filter.js';
export { normalizeToolArguments, type SchemaHintRecord } from './tool-argument-normalizer.js';
export { repairPossiblyTruncatedObjectJson } from './json-repair.js';
export {
    openaiStreamToInternal,
    type OpenAIStreamChunk,
    type StreamParserOptions,
} from './stream-parser.js';
export { OpenAIShimProvider } from './provider.js';
export {
    compressToolHistory,
    type CompressToolHistoryOptions,
} from './compress-tool-history.js';
export {
    CodexShimProvider,
    buildCodexInput,
    codexStreamToInternal,
    type CodexInputItem,
    type CodexOutputItem,
    type CodexResponseCreateParams,
    type CodexStreamEvent,
    type CodexStreamParserOptions,
    type CodexUsage,
} from './codex-shim.js';
