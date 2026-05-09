// Clean-room reimplementation barrel for the LLM retry layer.
// No original source code copied.

export {
    FatalLLMError,
    OAuth401Error,
    OverloadError,
    PromptTooLongError,
    StreamIdleError,
    ThrottleError,
    TransientIOError,
    isClassifiedLLMError,
    type ClassifiedLLMError,
    type LLMErrorKind,
} from './errors.js';
export { classifyLLMError } from './classify.js';
export { withRetry, type WithRetryDeps } from './with-retry.js';
export {
    DEFAULT_STREAM_IDLE_MS,
    createIdleWatchdog,
    wrapStream,
    type IdleWatchdog,
    type IdleWatchdogOptions,
    type IdleWatchdogTimer,
} from './stream-idle.js';
