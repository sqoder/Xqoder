// ============================================================
// AWS Bedrock Provider
// 通过 AWS Bedrock 统一端点访问 Anthropic/Titan 等模型
// 参考 OpenCode: internal/llm/provider/bedrock.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { AnthropicProvider } from '@xqoder/provider-anthropic';

const BEDROCK_DEFAULT_MODEL = 'anthropic.claude-3-7-sonnet-20250219-v1:0';

/**
 * BedrockProvider
 * AWS Bedrock 统一端点，目前代理到 Anthropic Provider
 *
 * 环境变量：
 *   - AWS_REGION / AWS_DEFAULT_REGION
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_BEDROCK_ENDPOINT (可选自定义端点)
 *
 * 支持模型：
 *   - anthropic.claude-3-7-sonnet   (Claude 3.7 Sonnet)
 *   - anthropic.claude-3-5-haiku    (Claude 3.5 Haiku)
 *   - anthropic.claude-sonnet-4     (Claude Sonnet 4)
 */
export class BedrockProvider extends AnthropicProvider {
    override readonly name = 'bedrock';

    constructor(config: LLMProviderConfig) {
        const region = process.env['AWS_REGION']
            ?? process.env['AWS_DEFAULT_REGION']
            ?? 'us-east-1';

        const endpoint = config.baseUrl
            ?? process.env['AWS_BEDROCK_ENDPOINT']
            ?? `https://bedrock-runtime.${region}.amazonaws.com`;

        super(normalizeLLMConfig({
            ...config,
            provider: 'bedrock' as LLMProviderConfig['provider'],
            model: config.model || BEDROCK_DEFAULT_MODEL,
            baseUrl: endpoint,
            apiKey: config.apiKey ?? process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
        }));
    }
}
