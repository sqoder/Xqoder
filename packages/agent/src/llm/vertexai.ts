// ============================================================
// Google Vertex AI Provider
// 通过 Vertex AI 端点访问 Gemini 等模型
// 参考 OpenCode: internal/llm/provider/vertexai.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { GeminiProvider } from './gemini.js';

/**
 * VertexAIProvider
 * 通过 Google Cloud Vertex AI 端点访问 Gemini 模型
 * 适用于企业用户需要 VPC/Private 网络和 IAM 权限控制的场景
 *
 * 环境变量：
 *   - VERTEXAI_PROJECT      — GCP 项目 ID
 *   - VERTEXAI_LOCATION     — GCP 区域 (e.g., us-central1)
 *   - GOOGLE_APPLICATION_CREDENTIALS — 服务账户 JSON Key
 *
 * 端点格式：
 *   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}
 */
export class VertexAIProvider extends GeminiProvider {
    override readonly name = 'vertexai';

    constructor(config: LLMProviderConfig) {
        const project = process.env['VERTEXAI_PROJECT'] ?? '';
        const location = process.env['VERTEXAI_LOCATION'] ?? 'us-central1';
        const model = config.model || 'gemini-2.0-flash';

        // Vertex AI 使用不同的端点格式
        const baseUrl = config.baseUrl
            ?? `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/openapi`;

        super(normalizeLLMConfig({
            ...config,
            provider: 'vertexai' as LLMProviderConfig['provider'],
            model,
            baseUrl,
            apiKey: config.apiKey ?? process.env['GOOGLE_API_KEY'] ?? '',
        }));
    }
}
