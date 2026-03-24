// ============================================================
// @xqoder/shared — 统一导出
// ============================================================

export type { XQoderConfig } from './types.js';
export * from './config-types.js';
export * from './project-types.js';
export * from './runtime-types.js';
export * from './test-types.js';
export * from './deploy-types.js';
export * from './workflow-types.js';
export * from './tool-types.js';
export * from './message-types.js';
export * from './llm-types.js';
export * from './errors.js';
export * from './llm.js';
export * from './paths.js';
export * from './project-memory.js';
export * from './project-permissions.js';
export * from './tool-permissions.js';
export { Logger, LogLevel, logger } from './logger.js';
export {
    ConfigManager,
    type ConfigLoadMetadata,
    type ConfigLoadOptions,
    type ConfigManagerOptions,
    type ConfigSourceInfo,
    configManager,
    loadTuiConfig,
    writeTuiConfig,
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
export { CostCalculator, DEFAULT_CNY_RATE, type CostResult, type CostUsage } from './cost-calculator.js';
export {
    loadCustomCommands,
    resolveCustomCommand,
    listCustomCommandReferences,
    executeCustomCommand,
    type CustomCommand,
    type CustomCommandReference,
} from './custom-commands.js';
export { loadGitHubCopilotToken } from './copilot-auth.js';
export { formatOutput, createSpinner, type OutputFormat, type FormatOptions } from './format.js';
export {
    DebugLogger,
    createDebugLogger,
    type DebugLoggerOptions,
} from './debug-logger.js';
export type { MessageAttachment, MessageAttachmentKind, ContentPart, FinishReason } from './message-types.js';
export { getMessageAttachmentKind, getTextContent, getReasoningContent, getToolCallParts } from './message-types.js';
export {
    detectProviderFromEnv,
    listAvailableProviders,
    getDefaultModelForProvider,
} from './provider-detect.js';
export { installPanicHandler, type PanicLogEntry } from './panic.js';
