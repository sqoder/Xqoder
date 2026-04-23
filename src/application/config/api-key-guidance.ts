import type { LLMProviderName } from '@xqoder/shared';

export const MISSING_API_KEY_GUIDANCE =
    'LLM API key not configured. Use xqoder auth login <provider> --api-key <key>, run xqoder config init --api-key <key>, or set XQODER_LLM_API_KEY.';

export function llmProviderRequiresApiKey(provider: LLMProviderName | undefined): boolean {
    return provider !== 'local';
}
