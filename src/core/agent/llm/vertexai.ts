// ============================================================
// Google Vertex AI Provider
// Accesses Gemini and other models through Vertex AI endpoints
// Reference: internal/llm/provider/vertexai.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { GeminiProvider } from './gemini.js';

/**
 * VertexAIProvider
 * Accesses Gemini models through Google Cloud Vertex AI endpoints
 * Suitable for enterprise users requiring VPC/Private network and IAM permission control
 *
 * Environment Variables:
 *   - VERTEXAI_PROJECT      — GCP Project ID
 *   - VERTEXAI_LOCATION     — GCP Region (e.g., us-central1)
 *   - GOOGLE_APPLICATION_CREDENTIALS — Service Account JSON Key
 *
 * Endpoint Format:
 *   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}
 */
export class VertexAIProvider extends GeminiProvider {
    override readonly name = 'vertexai';

    constructor(config: LLMProviderConfig) {
        const project = process.env['VERTEXAI_PROJECT'] ?? '';
        const location = process.env['VERTEXAI_LOCATION'] ?? 'us-central1';
        const model = config.model || 'gemini-2.0-flash';

        // Vertex AI uses a different endpoint format
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
