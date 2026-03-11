// ============================================================
// @xqoder/shared — 统一导出
// ============================================================

export * from './types.js';
export * from './errors.js';
export * from './llm.js';
export * from './paths.js';
export { Logger, LogLevel, logger } from './logger.js';
export {
    ConfigManager,
    type ConfigLoadMetadata,
    type ConfigLoadOptions,
    type ConfigManagerOptions,
    type ConfigSourceInfo,
    configManager,
    loadTuiConfig,
    normalizeXQoderConfig,
    resolveAgentLLMConfig,
    resolveConfigWithEnvOverrides,
    resolveDefaultAgentName,
    resolveSmallModelConfig,
    substituteVars,
    substituteConfigVars,
} from './config.js';
export { EventBus, globalEventBus, type XQoderEvents } from './event-bus.js';
export { generateConfigSchema, generateConfigSchemaJson } from './schema.js';
export {
    getModelCost,
    calculateCost,
    getContextWindow,
    formatCost,
    formatTokens,
    type ModelCost,
} from './model-costs.js';
export {
    loadCustomCommands,
    executeCustomCommand,
    type CustomCommand,
} from './custom-commands.js';
export { loadGitHubCopilotToken } from './copilot-auth.js';
export { formatOutput, createSpinner, type OutputFormat, type FormatOptions } from './format.js';
export {
    DebugLogger,
    createDebugLogger,
    type DebugLoggerOptions,
} from './debug-logger.js';
export type { MessageAttachment, ContentPart, FinishReason } from './types.js';
export { getTextContent, getReasoningContent, getToolCallParts } from './types.js';
export {
    detectProviderFromEnv,
    listAvailableProviders,
    getDefaultModelForProvider,
} from './provider-detect.js';
export { installPanicHandler, type PanicLogEntry } from './panic.js';
